// ArcadiaHelper: a small background process for things Chromium can't do.
//
//  - Pair a DualSense over classic Bluetooth (IOBluetooth). CoreBluetooth can't
//    pair it: the controller is a classic Bluetooth HID device, not BLE.
//  - Report connected controllers, battery level, charging state (GameController).
//  - Set the light bar color.
//  - Watch for a "quit to Arcadia" gesture while an emulator is frontmost
//    (GCController.shouldMonitorBackgroundEvents).
//
// Protocol: JSON lines on stdin (commands) / stdout (events).
// See src/shared/helper-protocol.ts.

import Foundation
import GameController
import IOBluetooth

let helperVersion = "0.1.0"

// MARK: - Output

let outLock = NSLock()
func emit(_ object: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: object),
          let line = String(data: data, encoding: .utf8) else { return }
    outLock.lock()
    FileHandle.standardOutput.write((line + "\n").data(using: .utf8)!)
    outLock.unlock()
}

func log(_ message: String, level: String = "info") {
    emit(["event": "log", "level": level, "message": message])
}

// MARK: - Controllers (GameController)

final class ControllerMonitor {
    private var watching = false
    private var holdMs = 1000
    private var homeDownAt: Date?
    private var chordDownAt: Date?
    private var fired = false
    private var timer: Timer?
    private var pollTimer: Timer?
    private var lightColor: GCColor?

    init() {
        let nc = NotificationCenter.default
        nc.addObserver(forName: .GCControllerDidConnect, object: nil, queue: .main) { [weak self] note in
            if let c = note.object as? GCController { self?.attach(c) }
            self?.report()
        }
        nc.addObserver(forName: .GCControllerDidDisconnect, object: nil, queue: .main) { [weak self] _ in
            self?.report()
        }
        GCController.controllers().forEach(attach)
        // Battery changes have no notification; poll gently.
        timer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in self?.report() }
    }

    static func isDualSense(_ c: GCController) -> Bool {
        if c.extendedGamepad is GCDualSenseGamepad { return true }
        return (c.vendorName ?? "").localizedCaseInsensitiveContains("DualSense")
    }

    func report() {
        let list: [[String: Any]] = GCController.controllers().enumerated().map { index, c in
            var info: [String: Any] = [
                "id": "\(index)-\(c.vendorName ?? "controller")",
                "name": c.vendorName ?? "Controller",
                "isDualSense": ControllerMonitor.isDualSense(c),
                "battery": NSNull(),
                "charging": NSNull(),
            ]
            if let battery = c.battery {
                info["battery"] = Double(battery.batteryLevel)
                switch battery.batteryState {
                case .charging, .full: info["charging"] = true
                case .discharging: info["charging"] = false
                default: break
                }
            }
            return info
        }
        emit(["event": "controllers", "controllers": list])
    }

    func setLight(r: Double, g: Double, b: Double) {
        let color = GCColor(red: Float(r / 255), green: Float(g / 255), blue: Float(b / 255))
        lightColor = color
        for c in GCController.controllers() { c.light?.color = color }
    }

    func setWatching(_ enabled: Bool, holdMs: Int) {
        watching = enabled
        self.holdMs = holdMs
        // Without this, GameController only delivers input while *we* are frontmost,
        // which we never are: the emulator is.
        GCController.shouldMonitorBackgroundEvents = enabled
        homeDownAt = nil
        chordDownAt = nil
        fired = false
        pollTimer?.invalidate()
        pollTimer = nil
        if enabled {
            // Poll at 20 Hz: a hold has to be noticed while nothing changes.
            pollTimer = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [weak self] _ in self?.poll() }
        }
    }

    private func attach(_ c: GCController) {
        // Fresh connections get the light bar color Arcadia last set.
        if let color = lightColor { c.light?.color = color }
    }

    /// Hold Home, or hold Create + Options (fallback when macOS claims Home for the Games app).
    private func poll() {
        let now = Date()
        var home = false
        var chord = false
        for c in GCController.controllers() {
            guard let pad = c.extendedGamepad else { continue }
            home = home || (pad.buttonHome?.isPressed ?? false)
            chord = chord || ((pad.buttonOptions?.isPressed ?? false) && pad.buttonMenu.isPressed)
        }
        homeDownAt = home ? (homeDownAt ?? now) : nil
        chordDownAt = chord ? (chordDownAt ?? now) : nil
        if !home && !chord { fired = false }
        guard !fired else { return }

        let threshold = Double(holdMs) / 1000
        if let t = homeDownAt, now.timeIntervalSince(t) >= threshold {
            fired = true
            emit(["event": "quitGesture", "source": "home"])
        } else if let t = chordDownAt, now.timeIntervalSince(t) >= threshold {
            fired = true
            emit(["event": "quitGesture", "source": "chord"])
        }
    }
}

// MARK: - Pairing (IOBluetooth)

final class Pairer: NSObject, IOBluetoothDeviceInquiryDelegate, IOBluetoothDevicePairDelegate {
    private var inquiry: IOBluetoothDeviceInquiry?
    private var pair: IOBluetoothDevicePair?
    private var device: IOBluetoothDevice?
    private var deadline: Date = .distantFuture
    private var active = false

    static func looksLikeController(_ name: String?) -> Bool {
        guard let n = name?.lowercased() else { return false }
        return n.contains("dualsense") || n.contains("wireless controller")
    }

    func start(timeoutSec: Int) {
        cancel(silently: true)
        device = nil
        active = true
        deadline = Date().addingTimeInterval(TimeInterval(timeoutSec))

        // Already paired before (e.g. via System Settings) → just connect.
        if let known = (IOBluetoothDevice.pairedDevices() as? [IOBluetoothDevice])?.first(where: { Pairer.looksLikeController($0.name) }) {
            emit(["event": "pair", "phase": "found", "name": known.name ?? "Controller"])
            connect(known)
            return
        }

        emit(["event": "pair", "phase": "searching"])
        let inq = IOBluetoothDeviceInquiry(delegate: self)!
        inq.updateNewDeviceNames = true
        inq.inquiryLength = 10
        inquiry = inq
        let status = inq.start()
        if status != kIOReturnSuccess {
            finish("failed", message: "Bluetooth search failed (\(status)). Is Bluetooth on, and does Arcadia have Bluetooth permission?")
        }
    }

    func cancel(silently: Bool = false) {
        inquiry?.stop()
        inquiry = nil
        pair?.stop()
        pair = nil
        if active && !silently { emit(["event": "pair", "phase": "cancelled"]) }
        active = false
    }

    private func finish(_ phase: String, message: String? = nil, name: String? = nil) {
        var payload: [String: Any] = ["event": "pair", "phase": phase]
        if let message { payload["message"] = message }
        if let name { payload["name"] = name }
        emit(payload)
        inquiry?.stop()
        inquiry = nil
        active = false
    }

    private func connect(_ dev: IOBluetoothDevice) {
        device = dev
        emit(["event": "pair", "phase": "pairing", "name": dev.name ?? "Controller"])
        if dev.isPaired() {
            let r = dev.openConnection()
            if r == kIOReturnSuccess || dev.isConnected() {
                finish("connected", name: dev.name)
            } else {
                finish("failed", message: "Found the controller but couldn't connect (\(r)). Hold Create + Home again.")
            }
            return
        }
        let p = IOBluetoothDevicePair(device: dev)!
        p.delegate = self
        pair = p
        let r = p.start()
        if r != kIOReturnSuccess { finish("failed", message: "Pairing couldn't start (\(r)).") }
    }

    // IOBluetoothDeviceInquiryDelegate
    func deviceInquiryDeviceFound(_ sender: IOBluetoothDeviceInquiry!, device: IOBluetoothDevice!) {
        guard active, let device, Pairer.looksLikeController(device.name) else { return }
        sender.stop()
        emit(["event": "pair", "phase": "found", "name": device.name ?? "Controller"])
        connect(device)
    }

    func deviceInquiryDeviceNameUpdated(_ sender: IOBluetoothDeviceInquiry!, device: IOBluetoothDevice!, devicesRemaining: UInt32) {
        deviceInquiryDeviceFound(sender, device: device)
    }

    func deviceInquiryComplete(_ sender: IOBluetoothDeviceInquiry!, error: IOReturn, aborted: Bool) {
        // Still searching: nothing found yet and not cancelled.
        guard active, device == nil, !aborted else { return }
        if Date() < deadline {
            // Inquiries last ~10s; keep searching until our own deadline.
            _ = sender.start()
        } else {
            finish("timeout", message: "No controller found. Hold Create + Home until the light bar flashes quickly.")
        }
    }

    // IOBluetoothDevicePairDelegate
    // The DualSense uses "just works" Secure Simple Pairing: confirm without a code.
    func devicePairingUserConfirmationRequest(_ sender: Any!, numericValue: BluetoothNumericValue) {
        (sender as? IOBluetoothDevicePair)?.replyUserConfirmation(true)
    }

    func devicePairingFinished(_ sender: Any!, error: IOReturn) {
        guard let dev = device else { return }
        if error == kIOReturnSuccess {
            _ = dev.openConnection()
            finish("connected", name: dev.name)
        } else {
            finish("failed", message: "Pairing failed (\(error)). Hold Create + Home and try again.")
        }
    }
}

// MARK: - Command loop

let monitor = ControllerMonitor()
let pairer = Pairer()

func handle(line: String) {
    guard let data = line.data(using: .utf8),
          let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let cmd = obj["cmd"] as? String else {
        log("Unreadable command", level: "warn")
        return
    }
    switch cmd {
    case "status":
        monitor.report()
    case "pair":
        pairer.start(timeoutSec: obj["timeoutSec"] as? Int ?? 60)
    case "cancelPair":
        pairer.cancel()
    case "setLight":
        monitor.setLight(r: obj["r"] as? Double ?? 0, g: obj["g"] as? Double ?? 0, b: obj["b"] as? Double ?? 0)
    case "watch":
        monitor.setWatching(obj["enabled"] as? Bool ?? false, holdMs: obj["holdMs"] as? Int ?? 1000)
    default:
        log("Unknown command \(cmd)", level: "warn")
    }
}

// Read stdin on a background thread; handle commands on the main run loop,
// which GameController and IOBluetooth callbacks also use.
Thread {
    while let line = readLine(strippingNewline: true) {
        DispatchQueue.main.async { handle(line: line) }
    }
    // Parent closed stdin (Arcadia quit): exit with it.
    exit(0)
}.start()

emit(["event": "ready", "version": helperVersion])
DispatchQueue.main.async { monitor.report() }
RunLoop.main.run()

// Apple Intelligence: das Sprachmodell direkt auf dem Mac (ab macOS 26) – kostenlos, ohne Anmeldung.
// Die Werkzeuge (Kalender, To-dos, WhatsApp …) liegen im Server; das Modell ruft sie über die Brücke auf.

import Foundation
#if canImport(FoundationModels)
import FoundationModels
#endif

enum Intelligence {
    static func status() -> [String: Any] {
        #if canImport(FoundationModels)
        if #available(macOS 26.0, *) {
            return AppleModel.status()
        }
        return ["available": false, "reason": "osTooOld"]
        #else
        return ["available": false, "reason": "notBuilt"]
        #endif
    }

    static func respond(_ args: [String: Any], caller: ToolCaller, done: @escaping BridgeReply) {
        #if canImport(FoundationModels)
        if #available(macOS 26.0, *) {
            Task {
                do {
                    let text = try await AppleModel.respond(args, caller: caller)
                    done(.success(["text": text]))
                } catch {
                    done(.failure(AppleModel.failure(error)))
                }
            }
            return
        }
        #endif
        done(.failure(BridgeFailure("Apple Intelligence gibt es erst ab macOS 26.", code: "unavailable")))
    }
}

#if canImport(FoundationModels)
@available(macOS 26.0, *)
struct BridgeTool: Tool {
    typealias Arguments = GeneratedContent
    typealias Output = String

    let name: String
    let description: String
    let parameters: GenerationSchema
    let runId: String
    let caller: ToolCaller

    func call(arguments: GeneratedContent) async throws -> String {
        return await caller.callTool(runId: runId, name: name, json: arguments.jsonString)
    }
}

@available(macOS 26.0, *)
enum AppleModel {
    static func status() -> [String: Any] {
        switch SystemLanguageModel.default.availability {
        case .available:
            return ["available": true]
        case .unavailable(let reason):
            switch reason {
            case .deviceNotEligible: return ["available": false, "reason": "deviceNotEligible"]
            case .appleIntelligenceNotEnabled: return ["available": false, "reason": "appleIntelligenceNotEnabled"]
            case .modelNotReady: return ["available": false, "reason": "modelNotReady"]
            @unknown default: return ["available": false, "reason": "unknown"]
            }
        }
    }

    static func cleanName(_ s: String) -> String {
        return String(s.map { $0.isLetter || $0.isNumber ? $0 : "_" })
    }

    /// Baut aus dem JSON-Schema eines Werkzeugs ein Schema, das Apple Intelligence versteht.
    static func schema(_ name: String, _ json: [String: Any]) -> DynamicGenerationSchema {
        let type = json["type"] as? String ?? "string"
        let desc = json["description"] as? String
        switch type {
        case "object":
            let props = json["properties"] as? [String: Any] ?? [:]
            let required = Set(json["required"] as? [String] ?? [])
            var list: [DynamicGenerationSchema.Property] = []
            for key in props.keys.sorted() {
                guard let sub = props[key] as? [String: Any] else { continue }
                list.append(DynamicGenerationSchema.Property(
                    name: key,
                    description: sub["description"] as? String,
                    schema: schema("\(name)_\(cleanName(key))", sub),
                    isOptional: !required.contains(key)))
            }
            return DynamicGenerationSchema(name: name, description: desc, properties: list)
        case "array":
            let items = json["items"] as? [String: Any] ?? ["type": "string"]
            return DynamicGenerationSchema(arrayOf: schema("\(name)_eintrag", items), minimumElements: json["minItems"] as? Int, maximumElements: json["maxItems"] as? Int)
        case "integer":
            return DynamicGenerationSchema(type: Int.self, guides: [])
        case "number":
            return DynamicGenerationSchema(type: Double.self, guides: [])
        case "boolean":
            return DynamicGenerationSchema(type: Bool.self, guides: [])
        default:
            if let options = json["enum"] as? [String], !options.isEmpty {
                return DynamicGenerationSchema(name: name, description: desc, anyOf: options)
            }
            return DynamicGenerationSchema(type: String.self, guides: [])
        }
    }

    static func respond(_ args: [String: Any], caller: ToolCaller) async throws -> String {
        let runId = args["runId"] as? String ?? ""
        let instructions = args["instructions"] as? String ?? ""
        let prompt = args["prompt"] as? String ?? ""
        let defs = args["tools"] as? [[String: Any]] ?? []
        var tools: [any Tool] = []
        for (i, t) in defs.enumerated() {
            guard let name = t["name"] as? String else { continue }
            let params = t["parameters"] as? [String: Any] ?? ["type": "object", "properties": [String: Any]()]
            let root = schema("Werkzeug\(i)_\(cleanName(name))", params)
            let generation = try GenerationSchema(root: root, dependencies: [])
            tools.append(BridgeTool(name: name, description: t["description"] as? String ?? name, parameters: generation, runId: runId, caller: caller))
        }
        let session = LanguageModelSession(tools: tools, instructions: instructions)
        let response = try await session.respond(to: prompt)
        return response.content
    }

    static func failure(_ error: Error) -> BridgeFailure {
        if let e = error as? LanguageModelSession.GenerationError {
            switch e {
            case .exceededContextWindowSize:
                return BridgeFailure("Das war zu viel auf einmal für Apple Intelligence. Frag bitte kürzer oder fang ein neues Gespräch an.", code: "tooLong")
            case .guardrailViolation:
                return BridgeFailure("Dazu antwortet Apple Intelligence leider nicht.", code: "guardrail")
            case .unsupportedLanguageOrLocale:
                return BridgeFailure("Apple Intelligence versteht diese Sprache auf deinem Mac noch nicht. Stell unter Systemeinstellungen → Apple Intelligence & Siri die Sprache auf Deutsch.", code: "language")
            case .assetsUnavailable:
                return BridgeFailure("Apple Intelligence lädt gerade noch. Versuch es gleich nochmal.", code: "notReady")
            case .rateLimited, .concurrentRequests:
                return BridgeFailure("Apple Intelligence ist gerade beschäftigt. Versuch es gleich nochmal.", code: "busy")
            default:
                break
            }
        }
        return BridgeFailure("Apple Intelligence: \(error.localizedDescription)", code: "error")
    }
}
#endif

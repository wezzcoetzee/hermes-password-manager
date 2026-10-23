// Minimal HTTP/1.1 server on the loopback interface. One request per connection.
import Foundation
import Network

struct HTTPRequest {
    let method: String
    let path: String
    let headers: [String: String] // lower-cased names
    let body: Data
}

final class HTTPServer {
    private let listener: NWListener
    private let work = DispatchQueue(label: "dev.agentvault.helper.requests") // serial: one prompt at a time
    private let handler: (HTTPRequest) -> (Int, Data)
    private static let maxBytes = 256 * 1024

    init(port: UInt16, handler: @escaping (HTTPRequest) -> (Int, Data)) throws {
        let parameters = NWParameters.tcp
        parameters.requiredInterfaceType = .loopback
        parameters.allowLocalEndpointReuse = true
        guard let nwPort = NWEndpoint.Port(rawValue: port) else { throw HelperError.usage("invalid port") }
        listener = try NWListener(using: parameters, on: nwPort)
        self.handler = handler
    }

    func start() {
        listener.newConnectionHandler = { [weak self] connection in
            connection.start(queue: .global())
            self?.receive(connection, buffer: Data())
        }
        listener.start(queue: .global())
    }

    private func receive(_ connection: NWConnection, buffer: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 65_536) { [weak self] data, _, isComplete, error in
            guard let self else { return }
            var buffer = buffer
            if let data { buffer.append(data) }
            if buffer.count > Self.maxBytes { return self.send(connection, 413, Data("{\"error\":\"body_too_large\"}".utf8)) }
            if let request = Self.parse(buffer) {
                self.work.async {
                    let (status, body) = self.handler(request)
                    self.send(connection, status, body)
                }
            } else if isComplete || error != nil {
                connection.cancel()
            } else {
                self.receive(connection, buffer: buffer)
            }
        }
    }

    private func send(_ connection: NWConnection, _ status: Int, _ body: Data) {
        let head = "HTTP/1.1 \(status) \(status == 200 ? "OK" : "Error")\r\nContent-Type: application/json\r\nContent-Length: \(body.count)\r\nConnection: close\r\n\r\n"
        connection.send(content: Data(head.utf8) + body, completion: .contentProcessed { _ in connection.cancel() })
    }

    /// Returns nil until the full header block and Content-Length body have arrived.
    static func parse(_ buffer: Data) -> HTTPRequest? {
        guard let split = buffer.range(of: Data("\r\n\r\n".utf8)) else { return nil }
        let lines = String(decoding: buffer[..<split.lowerBound], as: UTF8.self).components(separatedBy: "\r\n")
        let start = lines.first?.split(separator: " ") ?? []
        guard start.count >= 2 else { return nil }
        var headers: [String: String] = [:]
        for line in lines.dropFirst() {
            guard let colon = line.firstIndex(of: ":") else { continue }
            headers[line[..<colon].lowercased()] = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
        }
        let length = Int(headers["content-length"] ?? "0") ?? 0
        let body = buffer[split.upperBound...]
        guard body.count >= length else { return nil }
        return HTTPRequest(method: String(start[0]), path: String(start[1]), headers: headers, body: Data(body.prefix(length)))
    }
}

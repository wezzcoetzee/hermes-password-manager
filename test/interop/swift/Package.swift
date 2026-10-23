// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "Interop",
    dependencies: [.package(url: "https://github.com/apple/swift-crypto.git", from: "3.0.0")],
    targets: [.executableTarget(name: "Interop", dependencies: [.product(name: "Crypto", package: "swift-crypto")])]
)

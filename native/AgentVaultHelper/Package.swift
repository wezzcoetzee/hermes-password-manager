// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "AgentVaultHelper",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "AgentVaultHelper",
            linkerSettings: [
                .linkedFramework("AppKit"),
                .linkedFramework("CryptoKit"),
                .linkedFramework("LocalAuthentication"),
                .linkedFramework("Network"),
                .linkedFramework("Security"),
            ]
        ),
    ]
)

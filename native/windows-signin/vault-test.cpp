#include "vault.hpp"
#include <iostream>
#include <stdexcept>
int main() {
    try {
        jarvis::Vault value; value.account = L"Synthetic\\Fixture"; value.sid = L"S-1-5-21-1-2-3-1001"; value.password = L"SYNTHETIC ONLY, never a real password"; value.computer = jarvis::randomId(); value.publicKey = "synthetic fixture";
        auto raw = jarvis::encode(value), sealed = jarvis::protect(raw, false); if (raw == sealed) throw 1;
        auto recovered = jarvis::protect(sealed, true); auto decoded = jarvis::decode(recovered);
        if (decoded.password != value.password || decoded.sid != value.sid || decoded.computer != value.computer) throw 1;
        SecureZeroMemory(raw.data(), raw.size());
        sealed[sealed.size() / 2] ^= 1; bool rejected = false; try { auto invalid = jarvis::protect(sealed, true); SecureZeroMemory(invalid.data(), invalid.size()); } catch (...) { rejected = true; }
        if (!rejected || jarvis::verifyPhone("invalid", "payload", "signature") || jarvis::randomNonce().size() != 43) throw 1;
        std::cout << "Synthetic machine-DPAPI vault roundtrip, tamper rejection and bounded nonce passed. No files or credentials read.\n"; return 0;
    } catch (...) { std::cerr << "Synthetic vault check failed.\n"; return 1; }
}

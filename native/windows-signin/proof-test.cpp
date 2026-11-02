#include "vault.hpp"
#include <sstream>
int wmain(int argc, wchar_t** argv) {
    if (argc != 2) return 1;
    try { const auto bytes = jarvis::readFile(argv[1], 8192); std::istringstream input(std::string(bytes.begin(), bytes.end())); std::string key, encoded, signature;
        if (!std::getline(input, key) || !std::getline(input, encoded) || !std::getline(input, signature)) return 1;
        const auto body = jarvis::unbase64(encoded); const std::string payload(body.begin(), body.end());
        return jarvis::verifyPhone(key, payload, signature) && !jarvis::verifyPhone(key, payload + "tamper", signature) ? 0 : 1;
    } catch (...) { return 1; }
}

#include "vault.hpp"
#include <shlobj.h>
#include <sddl.h>
#include <bcrypt.h>
#include <wincrypt.h>
#include <array>
#include <stdexcept>
#include <cstring>
#include <mutex>
namespace jarvis {
std::wstring responseFolderAcl(const std::wstring& sid) {
    return L"O:BAG:BAD:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;GRGWGXSD;;;" + sid + L")";
}
void publicTrace(const std::wstring& sid, const std::string& requestId, const char* phase, unsigned long code) noexcept {
    if (sid.empty()) return;
    static std::mutex mutex; std::lock_guard guard(mutex);
    try {
        const auto path = storePath() + L"\\trace.txt";
        std::string history;
        try { const auto prior = readFile(path, 8192); history.assign(prior.begin(), prior.end()); } catch (...) {}
        history += std::to_string(milliseconds()) + " " + (requestId.empty() ? "none" : requestId) + " " + phase + " " + std::to_string(code) + "\n";
        if (history.size() > 7000) { const auto cut = history.find('\n', history.size() - 6000); history.erase(0, cut == std::string::npos ? history.size() : cut + 1); }
        saveFile(path, std::vector<BYTE>(history.begin(), history.end()), L"O:BAG:BAD:P(A;;FA;;;SY)(A;;FA;;;BA)(A;;GR;;;" + sid + L")");
    } catch (...) { /* Public diagnostics are not authentication authority. */ }
}
static void check(bool value) { if (!value) throw std::runtime_error("Native sign-in operation failed."); }
std::wstring storePath() { PWSTR value{}; check(SUCCEEDED(SHGetKnownFolderPath(FOLDERID_ProgramData, 0, nullptr, &value))); std::wstring out(value); CoTaskMemFree(value); return out + L"\\JARVIS-WindowsSignin"; }
std::wstring tokenSid(HANDLE token) {
    DWORD size{}; GetTokenInformation(token, TokenUser, nullptr, 0, &size); std::vector<BYTE> data(size);
    check(GetTokenInformation(token, TokenUser, data.data(), size, &size)); LPWSTR value{};
    check(ConvertSidToStringSidW(reinterpret_cast<TOKEN_USER*>(data.data())->User.Sid, &value)); std::wstring out(value); LocalFree(value); return out;
}
std::vector<BYTE> protect(const std::vector<BYTE>& value, bool decrypt) {
    DATA_BLOB input{ static_cast<DWORD>(value.size()), const_cast<BYTE*>(value.data()) }, output{};
    BYTE scope[] = "JARVIS_WINDOWS_NATIVE_VAULT_V1"; DATA_BLOB entropy{ sizeof(scope), scope };
    check(decrypt ? CryptUnprotectData(&input, nullptr, &entropy, nullptr, nullptr, CRYPTPROTECT_UI_FORBIDDEN, &output)
        : CryptProtectData(&input, L"JARVIS Windows sign-in", &entropy, nullptr, nullptr, CRYPTPROTECT_LOCAL_MACHINE | CRYPTPROTECT_UI_FORBIDDEN, &output));
    std::vector<BYTE> result(output.pbData, output.pbData + output.cbData); SecureZeroMemory(output.pbData, output.cbData); LocalFree(output.pbData); return result;
}
static void append(std::vector<BYTE>& out, const void* ptr, size_t size) {
    check(size <= 16384); const DWORD length = static_cast<DWORD>(size); const auto bytes = reinterpret_cast<const BYTE*>(&length);
    out.insert(out.end(), bytes, bytes + sizeof(length)); const auto data = static_cast<const BYTE*>(ptr); out.insert(out.end(), data, data + size);
}
std::vector<BYTE> encode(const Vault& value) {
    std::vector<BYTE> data{ 'J','W','V','1' };
    append(data, value.account.data(), value.account.size() * sizeof(wchar_t)); append(data, value.sid.data(), value.sid.size() * sizeof(wchar_t));
    append(data, value.password.data(), value.password.size() * sizeof(wchar_t)); append(data, value.computer.data(), value.computer.size()); append(data, value.publicKey.data(), value.publicKey.size()); return data;
}
Vault decode(std::vector<BYTE>& data) {
    check(data.size() >= 4 && std::memcmp(data.data(), "JWV1", 4) == 0); size_t offset = 4;
    auto next = [&]() { DWORD length{}; check(offset + sizeof(length) <= data.size()); std::memcpy(&length, data.data() + offset, sizeof(length)); offset += sizeof(length); check(length <= 16384 && offset + length <= data.size()); std::vector<BYTE> result(data.begin() + offset, data.begin() + offset + length); offset += length; return result; };
    auto wide = [&]() { auto bytes = next(); check(bytes.size() % sizeof(wchar_t) == 0); std::wstring result(bytes.size() / sizeof(wchar_t), L'\0'); std::memcpy(result.data(), bytes.data(), bytes.size()); SecureZeroMemory(bytes.data(), bytes.size()); return result; };
    Vault value; value.account = wide(); value.sid = wide(); value.password = wide();
    auto computer = next(), publicKey = next(); value.computer.assign(computer.begin(), computer.end()); value.publicKey.assign(publicKey.begin(), publicKey.end());
    check(offset == data.size() && !value.account.empty() && !value.sid.empty() && !value.password.empty() && value.computer.size() == 36);
    SecureZeroMemory(data.data(), data.size()); return value;
}
std::vector<BYTE> readFile(const std::wstring& path, DWORD limit) {
    HANDLE file = CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_DELETE, nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL | FILE_FLAG_OPEN_REPARSE_POINT, nullptr); check(file != INVALID_HANDLE_VALUE);
    BY_HANDLE_FILE_INFORMATION info{}; if (!GetFileInformationByHandle(file, &info) || (info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) || info.nFileSizeHigh || info.nFileSizeLow > limit) { CloseHandle(file); check(false); }
    std::vector<BYTE> value(info.nFileSizeLow); DWORD read{}; const bool ok = ReadFile(file, value.data(), static_cast<DWORD>(value.size()), &read, nullptr) && read == value.size(); CloseHandle(file); check(ok); return value;
}
void saveFile(const std::wstring& path, const std::vector<BYTE>& value, const std::wstring& acl, bool exclusive) {
    PSECURITY_DESCRIPTOR descriptor{}; check(ConvertStringSecurityDescriptorToSecurityDescriptorW(acl.c_str(), SDDL_REVISION_1, &descriptor, nullptr));
    SECURITY_ATTRIBUTES attributes{ sizeof(attributes), descriptor, FALSE };
    HANDLE file = CreateFileW(path.c_str(), GENERIC_WRITE, 0, &attributes, exclusive ? CREATE_NEW : CREATE_ALWAYS, FILE_FLAG_WRITE_THROUGH | FILE_FLAG_OPEN_REPARSE_POINT, nullptr); LocalFree(descriptor); check(file != INVALID_HANDLE_VALUE);
    BY_HANDLE_FILE_INFORMATION info{}; DWORD written{};
    bool ok = GetFileInformationByHandle(file, &info) && !(info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT)
        && WriteFile(file, value.data(), static_cast<DWORD>(value.size()), &written, nullptr) && written == value.size() && FlushFileBuffers(file);
    CloseHandle(file); check(ok);
}
Vault readVault() { auto encrypted = readFile(storePath() + L"\\vault.bin", 65536); auto raw = protect(encrypted, true); try { return decode(raw); } catch (...) { SecureZeroMemory(raw.data(), raw.size()); throw; } }
std::string base64(const BYTE* data, DWORD size) { DWORD length{}; check(CryptBinaryToStringA(data, size, CRYPT_STRING_BASE64 | CRYPT_STRING_NOCRLF, nullptr, &length)); std::string out(length, '\0'); check(CryptBinaryToStringA(data, size, CRYPT_STRING_BASE64 | CRYPT_STRING_NOCRLF, out.data(), &length)); out.resize(length); return out; }
std::vector<BYTE> unbase64(const std::string& value) { check(!value.empty() && value.size() <= 4096); DWORD size{}; check(CryptStringToBinaryA(value.data(), static_cast<DWORD>(value.size()), CRYPT_STRING_BASE64 | CRYPT_STRING_STRICT, nullptr, &size, nullptr, nullptr)); std::vector<BYTE> data(size); check(CryptStringToBinaryA(value.data(), static_cast<DWORD>(value.size()), CRYPT_STRING_BASE64 | CRYPT_STRING_STRICT, data.data(), &size, nullptr, nullptr)); return data; }
static std::array<BYTE,32> sha(const BYTE* data, size_t size) { std::array<BYTE,32> hash{}; BCRYPT_ALG_HANDLE algorithm{}; check(BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, nullptr, 0) >= 0); auto result = BCryptHash(algorithm, nullptr, 0, const_cast<BYTE*>(data), static_cast<ULONG>(size), hash.data(), static_cast<ULONG>(hash.size())); BCryptCloseAlgorithmProvider(algorithm, 0); check(result >= 0); return hash; }
std::string fingerprint(const std::string& publicKey) { auto data = unbase64(publicKey); const auto digest = sha(data.data(), data.size()); std::string out; constexpr char chars[] = "0123456789abcdef"; for (auto byte : digest) { out += chars[byte >> 4]; out += chars[byte & 15]; } return out; }
bool verifyPhone(const std::string& publicKey, const std::string& payload, const std::string& signature) {
    try {
        auto der = unbase64(publicKey), signedBytes = unbase64(signature); if (signedBytes.size() != 256) return false;
        CERT_PUBLIC_KEY_INFO* info{}; DWORD length{}; if (!CryptDecodeObjectEx(X509_ASN_ENCODING, X509_PUBLIC_KEY_INFO, der.data(), static_cast<DWORD>(der.size()), CRYPT_DECODE_ALLOC_FLAG, nullptr, &info, &length)) return false;
        BCRYPT_KEY_HANDLE key{}; const bool imported = CryptImportPublicKeyInfoEx2(X509_ASN_ENCODING, info, 0, nullptr, &key); LocalFree(info); if (!imported) return false;
        DWORD bits{}, returned{}; bool correct = BCryptGetProperty(key, BCRYPT_KEY_LENGTH, reinterpret_cast<BYTE*>(&bits), sizeof(bits), &returned, 0) >= 0 && bits == 2048;
        auto digest = sha(reinterpret_cast<const BYTE*>(payload.data()), payload.size()); BCRYPT_PKCS1_PADDING_INFO padding{ BCRYPT_SHA256_ALGORITHM };
        correct = correct && BCryptVerifySignature(key, &padding, digest.data(), static_cast<ULONG>(digest.size()), signedBytes.data(), static_cast<ULONG>(signedBytes.size()), BCRYPT_PAD_PKCS1) >= 0;
        BCryptDestroyKey(key); return correct;
    } catch (...) { return false; }
}
std::string randomId() { GUID guid{}; check(SUCCEEDED(CoCreateGuid(&guid))); wchar_t value[40]{}; StringFromGUID2(guid, value, 40); std::string out; for (size_t i = 1; i < 37; ++i) out += static_cast<char>(towlower(value[i])); return out; }
std::string randomNonce() { std::array<BYTE,32> data{}; check(BCryptGenRandom(nullptr, data.data(), static_cast<ULONG>(data.size()), BCRYPT_USE_SYSTEM_PREFERRED_RNG) >= 0); auto out = base64(data.data(), static_cast<DWORD>(data.size())); while (!out.empty() && out.back() == '=') out.pop_back(); for (auto& c : out) { if (c == '+') c = '-'; if (c == '/') c = '_'; } return out; }
long long milliseconds() { FILETIME now{}; GetSystemTimeAsFileTime(&now); ULARGE_INTEGER value{}; value.LowPart = now.dwLowDateTime; value.HighPart = now.dwHighDateTime; return static_cast<long long>(value.QuadPart / 10000 - 11644473600000ULL); }
}

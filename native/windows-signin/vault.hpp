#pragma once
#include <windows.h>
#include <string>
#include <vector>
namespace jarvis {
struct Vault {
    std::wstring account, sid, password;
    std::string computer, publicKey;
    ~Vault() { if (!password.empty()) SecureZeroMemory(password.data(), password.size() * sizeof(wchar_t)); }
};
std::wstring storePath();
std::vector<BYTE> protect(const std::vector<BYTE>& value, bool decrypt);
std::vector<BYTE> encode(const Vault& value);
Vault decode(std::vector<BYTE>& value);
Vault readVault();
bool verifyPhone(const std::string& publicKey, const std::string& payload, const std::string& signature);
std::string fingerprint(const std::string& publicKey);
std::string base64(const BYTE* data, DWORD size);
std::vector<BYTE> unbase64(const std::string& value);
std::string randomId();
std::string randomNonce();
long long milliseconds();
void saveFile(const std::wstring& path, const std::vector<BYTE>& value, const std::wstring& acl, bool exclusive = false);
std::vector<BYTE> readFile(const std::wstring& path, DWORD limit);
std::wstring tokenSid(HANDLE token);
std::wstring responseFolderAcl(const std::wstring& sid);
void publicTrace(const std::wstring& sid, const std::string& requestId, const char* phase, unsigned long code = 0) noexcept;
}

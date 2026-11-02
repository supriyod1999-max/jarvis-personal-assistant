#include "vault.hpp"
#include <wincred.h>
#define SECURITY_WIN32
#include <security.h>
#include <secext.h>
#include <sddl.h>
#include <iostream>
#include <sstream>
#include <array>
#include <regex>
static void require(bool ok) { if (!ok) throw 1; }
static void folder(const std::wstring& path, const std::wstring& acl) {
    PSECURITY_DESCRIPTOR descriptor{}; require(ConvertStringSecurityDescriptorToSecurityDescriptorW(acl.c_str(), SDDL_REVISION_1, &descriptor, nullptr));
    SECURITY_ATTRIBUTES attributes{ sizeof(attributes), descriptor, FALSE }; bool created = CreateDirectoryW(path.c_str(), &attributes); LocalFree(descriptor);
    // Re-enrollment must not silently reuse a directory with unknown permissions.
    require(created);
}
int wmain(int argc, wchar_t** argv) {
    std::array<wchar_t, CREDUI_MAX_USERNAME_LENGTH + 1> user{};
    std::array<wchar_t, CREDUI_MAX_PASSWORD_LENGTH + 1> password{};
    int result = 1; const char* stage = "public setup file";
    try {
        require(argc == 2); auto bytes = jarvis::readFile(argv[1], 4096); std::string config(bytes.begin(), bytes.end()); std::istringstream lines(config);
        jarvis::Vault vault; std::string sid; require(!!std::getline(lines, vault.computer) && !!std::getline(lines, sid) && !!std::getline(lines, vault.publicKey));
        require(std::regex_match(vault.computer, std::regex("[a-fA-F0-9]{8}-(?:[a-fA-F0-9]{4}-){3}[a-fA-F0-9]{12}")) && std::regex_match(sid, std::regex("S-1-5-(?:[0-9]+-){1,14}[0-9]+")));
        require(jarvis::fingerprint(vault.publicKey).size() == 64); vault.sid.assign(sid.begin(), sid.end());
        stage = "administrator permission";
        PSID admin{}; SID_IDENTIFIER_AUTHORITY authority = SECURITY_NT_AUTHORITY; BOOL member{};
        require(AllocateAndInitializeSid(&authority, 2, SECURITY_BUILTIN_DOMAIN_RID, DOMAIN_ALIAS_RID_ADMINS, 0,0,0,0,0,0, &admin));
        const bool checked = CheckTokenMembership(nullptr, admin, &member); FreeSid(admin); require(checked && member);
        const auto keyId = jarvis::fingerprint(vault.publicKey);
        std::wstring reviewedKey(keyId.begin(), keyId.end()); std::wstring reviewedComputer(vault.computer.begin(), vault.computer.end());
        const auto review = L"Pair this exact phone for Windows sign-in?\n\nComputer: " + reviewedComputer + L"\nWindows SID: " + vault.sid + L"\nPhone key: " + reviewedKey + L"\n\nCompare this key with JARVIS Settings. Continue only if you prepared this enrollment file yourself.";
        stage = "phone and Windows account review";
        require(MessageBoxW(nullptr, review.c_str(), L"Review Windows phone enrollment", MB_YESNO | MB_ICONQUESTION | MB_DEFBUTTON2) == IDYES);
        HANDLE current{}; require(OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &current)); auto currentSid = jarvis::tokenSid(current); CloseHandle(current); require(currentSid == vault.sid);
        ULONG length = static_cast<ULONG>(user.size()); require(GetUserNameExW(NameSamCompatible, user.data(), &length));
        CREDUI_INFOW info{ sizeof(info) }; info.pszCaptionText = L"JARVIS setup - Windows password, not PIN";
        info.pszMessageText = L"Enter your Windows ACCOUNT PASSWORD, not your Windows Hello PIN. If you have never set a password, cancel and set one in Windows Settings first. Your password stays in the protected laptop vault, off the phone, browser and AI.";
        BOOL save = FALSE; DWORD status = CredUIPromptForCredentialsW(&info, L"JARVIS Windows native vault", nullptr, 0, user.data(), static_cast<ULONG>(user.size()), password.data(), static_cast<ULONG>(password.size()), &save, CREDUI_FLAGS_GENERIC_CREDENTIALS | CREDUI_FLAGS_ALWAYS_SHOW_UI | CREDUI_FLAGS_DO_NOT_PERSIST);
        stage = "native password dialog"; require(status == NO_ERROR && password[0]);
        std::wstring account(user.data()), domain, name = account; const auto split = account.find(L'\\'); if (split != std::wstring::npos) { domain = account.substr(0, split); name = account.substr(split + 1); }
        stage = "Windows password and account verification";
        HANDLE tested{};
        if (!LogonUserW(name.c_str(), domain.empty() ? nullptr : domain.c_str(), password.data(), LOGON32_LOGON_INTERACTIVE, LOGON32_PROVIDER_DEFAULT, &tested)) {
            const DWORD code = GetLastError(); std::cerr << "Windows account verification error code: " << code << ". Use the account password, never the Windows Hello PIN.\n"; throw 1;
        }
        const auto approvedSid = jarvis::tokenSid(tested); CloseHandle(tested); require(approvedSid == vault.sid);
        vault.account = account; vault.password = password.data(); SecureZeroMemory(password.data(), password.size() * sizeof(wchar_t));
        stage = "protected local vault creation";
        const auto root = jarvis::storePath(); const std::wstring restricted = L"O:BAG:BAD:P(A;;FA;;;SY)(A;;FA;;;BA)";
        folder(root, restricted + L"(A;;GRGX;;;" + vault.sid + L")");
        folder(root + L"\\responses", jarvis::responseFolderAcl(vault.sid));
        folder(root + L"\\receipts", restricted);
        auto raw = jarvis::encode(vault); auto sealed = jarvis::protect(raw, false); SecureZeroMemory(raw.data(), raw.size());
        jarvis::saveFile(root + L"\\vault.bin", sealed, restricted, true);
        std::cout << "Native vault enrolled. Provider activation and test-environment acceptance are separate.\n"; result = 0;
    } catch (...) { std::cerr << "Enrollment cancelled or rejected during " << stage << ". No Windows sign-in option was registered.\n"; }
    SecureZeroMemory(user.data(), user.size() * sizeof(wchar_t)); SecureZeroMemory(password.data(), password.size() * sizeof(wchar_t)); return result;
}

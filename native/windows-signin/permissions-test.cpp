#include "vault.hpp"
#include <sddl.h>
#include <aclapi.h>
#include <iostream>
int wmain(int argc, wchar_t** argv) {
    if (argc != 2) return 1;
    std::wstring folder, file; int result = 1;
    try {
        HANDLE token{}; if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token)) throw 1;
        const auto sid = jarvis::tokenSid(token); CloseHandle(token);
        folder = std::wstring(argv[1]) + L"\\public-proof-permissions-" + std::wstring(36, L' ');
        const auto id = jarvis::randomId(); folder.replace(folder.size() - 36, 36, std::wstring(id.begin(), id.end()));
        // Use the real production DACL. Default test ownership remains this user,
        // so this isolated filesystem test does not need elevation or a live vault.
        const auto acl = jarvis::responseFolderAcl(sid); const auto dacl = acl.substr(acl.find(L"D:"));
        PSECURITY_DESCRIPTOR descriptor{};
        if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(dacl.c_str(), SDDL_REVISION_1, &descriptor, nullptr)) throw 1;
        SECURITY_ATTRIBUTES attributes{sizeof(attributes), descriptor, FALSE};
        const bool created = CreateDirectoryW(folder.c_str(), &attributes); LocalFree(descriptor); if (!created) throw 1;
        file = folder + L"\\synthetic-public-proof.sig";
        HANDLE proof = CreateFileW(file.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_NEW, FILE_ATTRIBUTE_NORMAL, nullptr);
        if (proof == INVALID_HANDLE_VALUE) throw 1; CloseHandle(proof);
        PACL inherited{}; PSECURITY_DESCRIPTOR security{};
        if (GetNamedSecurityInfoW(file.data(), SE_FILE_OBJECT, DACL_SECURITY_INFORMATION, nullptr, nullptr, &inherited, nullptr, &security) != ERROR_SUCCESS) throw 1;
        bool systemRead = false, adminRead = false;
        BYTE system[SECURITY_MAX_SID_SIZE]{}, admins[SECURITY_MAX_SID_SIZE]{}; DWORD systemSize = sizeof(system), adminSize = sizeof(admins);
        if (!CreateWellKnownSid(WinLocalSystemSid, nullptr, system, &systemSize) || !CreateWellKnownSid(WinBuiltinAdministratorsSid, nullptr, admins, &adminSize)) { LocalFree(security); throw 1; }
        for (DWORD index = 0; inherited && index < inherited->AceCount; ++index) {
            void* raw{}; if (!GetAce(inherited, index, &raw)) continue;
            const auto ace = static_cast<ACCESS_ALLOWED_ACE*>(raw);
            if (ace->Header.AceType != ACCESS_ALLOWED_ACE_TYPE || !(ace->Header.AceFlags & INHERITED_ACE) || !(ace->Mask & FILE_READ_DATA)) continue;
            if (EqualSid(&ace->SidStart, system)) systemRead = true;
            if (EqualSid(&ace->SidStart, admins)) adminRead = true;
        }
        LocalFree(security); if (!systemRead || !adminRead) throw 1;
        std::cout << "A newly created public approval file inherits SYSTEM and Administrators read access. No live vault, credentials or authentication used.\n"; result = 0;
    } catch (...) { std::cerr << "Public approval file inheritance test failed.\n"; }
    if (!file.empty()) DeleteFileW(file.c_str()); if (!folder.empty()) RemoveDirectoryW(folder.c_str()); return result;
}

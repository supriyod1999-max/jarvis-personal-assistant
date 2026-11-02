#include <windows.h>
#include <wtsapi32.h>
#include <sddl.h>
#include <iostream>
#include <string>
#include <vector>

struct Facts { DWORD session{}; std::wstring sid; bool locked{}, local{}; };
Facts facts() {
    Facts value; HANDLE token{};
    if (!ProcessIdToSessionId(GetCurrentProcessId(), &value.session) || !OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token)) throw 1;
    DWORD length{}; GetTokenInformation(token, TokenUser, nullptr, 0, &length);
    std::vector<BYTE> buffer(length);
    if (!GetTokenInformation(token, TokenUser, buffer.data(), length, &length)) { CloseHandle(token); throw 1; }
    CloseHandle(token); LPWSTR sid{};
    if (!ConvertSidToStringSidW(reinterpret_cast<TOKEN_USER*>(buffer.data())->User.Sid, &sid)) throw 1;
    value.sid = sid; LocalFree(sid);
    LPWSTR data{}; DWORD size{};
    if (!WTSQuerySessionInformationW(WTS_CURRENT_SERVER_HANDLE, value.session, WTSSessionInfoEx, &data, &size)) throw 1;
    if (size < sizeof(WTSINFOEXW) || reinterpret_cast<WTSINFOEXW*>(data)->Level != 1) { WTSFreeMemory(data); throw 1; }
    const auto state = reinterpret_cast<WTSINFOEXW*>(data)->Data.WTSInfoExLevel1.SessionFlags;
    WTSFreeMemory(data);
    if (state != WTS_SESSIONSTATE_LOCK && state != WTS_SESSIONSTATE_UNLOCK) throw 1;
    value.locked = state == WTS_SESSIONSTATE_LOCK;
    if (!WTSQuerySessionInformationW(WTS_CURRENT_SERVER_HANDLE, value.session, WTSClientProtocolType, &data, &size)) throw 1;
    value.local = size >= sizeof(USHORT) && *reinterpret_cast<USHORT*>(data) == 0 && WTSGetActiveConsoleSessionId() == value.session && value.session != 0;
    WTSFreeMemory(data); return value;
}
int wmain(int argc, wchar_t** argv) {
    try {
        if (argc == 2 && std::wstring(argv[1]) == L"self-test") { std::cout << "Fixed status/lock interface; no action performed.\n"; return 0; }
        const auto value = facts();
        if (argc == 2 && std::wstring(argv[1]) == L"status") {
            std::wcout << L"{\"sessionId\":" << value.session << L",\"accountSid\":\"" << value.sid
                << L"\",\"locked\":" << (value.locked ? L"true" : L"false") << L",\"local\":" << (value.local ? L"true" : L"false") << L"}";
            return 0;
        }
        if (argc != 4 || std::wstring(argv[1]) != L"lock" || !value.local || value.locked
            || std::to_wstring(value.session) != argv[2] || value.sid != argv[3]) throw 1;
        if (!LockWorkStation()) throw 1;
        // Windows reports initiation only. The caller must read WTS status again.
        std::cout << "{\"initiated\":true}"; return 0;
    } catch (...) { std::cerr << "The active Windows session could not be verified or controlled."; return 1; }
}

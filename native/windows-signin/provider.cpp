// Native V2 provider. The build never registers it. A separate owner-reviewed
// native enrollment and installer activate it for Windows logon acceptance.
#include "vault.hpp"
#include "approval-notifier.hpp"
#include <credentialprovider.h>
#include <wincred.h>
#include <ntsecapi.h>
#include <shlwapi.h>
#include <wtsapi32.h>
#include <atomic>
#include <sstream>
#include <new>

static constexpr CLSID providerId{ 0x981119e4,0x88bd,0x4f29,{0xa9,0xba,0xc1,0xa8,0x96,0x8b,0xe1,0x0e} };
static std::atomic<long> objects{};
class Provider final : public ICredentialProvider, public ICredentialProviderCredential2, public ICredentialProviderSetUserArray {
    std::atomic<ULONG> refs{1}; std::unique_ptr<jarvis::ApprovalNotifier> notifier;
    CREDENTIAL_PROVIDER_USAGE_SCENARIO scenario{CPUS_INVALID}; std::wstring sid; std::string key, computer, payload, requestId;
    DWORD session{}; long long expiry{}; bool initialized{}, approved{}, failed{}; std::string lastPhase;
    void record(const char* phase, DWORD code = 0) noexcept {
        try {
            if (requestId.empty() || lastPhase == phase) return;
            jarvis::publicTrace(sid, requestId, phase, code);
            const std::string value = "JARVIS_WINDOWS_STATUS_V1\n" + requestId + "\n" + phase + "\n" + std::to_string(code) + "\n" + std::to_string(expiry);
            jarvis::saveFile(jarvis::storePath() + L"\\status.txt", std::vector<BYTE>(value.begin(), value.end()), L"O:BAG:BAD:P(A;;FA;;;SY)(A;;FA;;;BA)(A;;GR;;;" + sid + L")");
            lastPhase = phase;
        } catch (...) { /* Diagnostics never grant sign-in authority. */ }
    }
    bool console() const { DWORD current{}; return ProcessIdToSessionId(GetCurrentProcessId(), &current) && current == session && session != 0 && WTSGetActiveConsoleSessionId() == session; }
    void start() {
        if (!initialized) { auto vault = jarvis::readVault(); sid = vault.sid; key = vault.publicKey; computer = vault.computer; initialized = true; }
        if (!ProcessIdToSessionId(GetCurrentProcessId(), &session) || !console()) throw 1;
        requestId = jarvis::randomId(); expiry = jarvis::milliseconds() + 30000;
        std::string account; for (auto character : sid) { if (character > 127) throw 1; account += static_cast<char>(character); }
        payload = "JARVIS_WINDOWS_SIGNIN_V1\nwindows.unlock\n" + jarvis::fingerprint(key) + "\n" + computer + "\n" + account + "\n" + std::to_string(session) + "\n" + jarvis::randomId() + "\n" + requestId + "\n" + jarvis::randomNonce() + "\n" + std::to_string(expiry);
        const std::wstring acl = L"O:BAG:BAD:P(A;;FA;;;SY)(A;;FA;;;BA)(A;;GR;;;" + sid + L")";
        jarvis::saveFile(jarvis::storePath() + L"\\challenge.txt", std::vector<BYTE>(payload.begin(), payload.end()), acl);
        approved = false; lastPhase.clear(); record(notifier ? "waiting" : "listener-unavailable");
        if (notifier) notifier->watch({jarvis::storePath() + L"\\responses\\" + std::wstring(requestId.begin(), requestId.end()) + L".sig", key, payload, requestId, expiry, sid});
    }
    void poll() noexcept {
        try {
            if (!initialized || failed || approved || !console()) return;
            if (jarvis::milliseconds() >= expiry) { start(); return; }
            auto bytes = jarvis::readFile(jarvis::storePath() + L"\\responses\\" + std::wstring(requestId.begin(), requestId.end()) + L".sig", 512);
            const std::string signature(bytes.begin(), bytes.end());
            if (!jarvis::verifyPhone(key, payload, signature)) { record("signature-rejected"); return; }
            if (jarvis::milliseconds() >= expiry) { record("expired"); return; }
            approved = true; record("phone-approved");
        } catch (...) { /* Missing/invalid/expired proof cannot become an approval. */ }
    }
    void stop() { notifier.reset(); approved = false; }
public:
    Provider() { objects++; }
    ~Provider() { jarvis::publicTrace(sid, requestId, "provider-destroyed"); stop(); objects--; }
    IFACEMETHODIMP QueryInterface(REFIID iid, void** out) override {
        if (!out) return E_POINTER; *out = nullptr;
        if (iid == IID_IUnknown || iid == IID_ICredentialProvider) *out = static_cast<ICredentialProvider*>(this);
        else if (iid == IID_ICredentialProviderCredential || iid == IID_ICredentialProviderCredential2) *out = static_cast<ICredentialProviderCredential2*>(this);
        else if (iid == IID_ICredentialProviderSetUserArray) *out = static_cast<ICredentialProviderSetUserArray*>(this);
        else return E_NOINTERFACE; AddRef(); return S_OK;
    }
    IFACEMETHODIMP_(ULONG) AddRef() override { return ++refs; }
    IFACEMETHODIMP_(ULONG) Release() override { auto remaining = --refs; if (!remaining) delete this; return remaining; }
    IFACEMETHODIMP SetUsageScenario(CREDENTIAL_PROVIDER_USAGE_SCENARIO value, DWORD) override { if (value != CPUS_LOGON && value != CPUS_UNLOCK_WORKSTATION) return E_NOTIMPL; scenario = value; return S_OK; }
    IFACEMETHODIMP SetSerialization(const CREDENTIAL_PROVIDER_CREDENTIAL_SERIALIZATION*) override { return E_NOTIMPL; }
    IFACEMETHODIMP Advise(ICredentialProviderEvents* value, UINT_PTR selected) override {
        jarvis::publicTrace(sid, requestId, "provider-advised");
        notifier.reset(); if (!value) return E_INVALIDARG;
        try {
            notifier = std::make_unique<jarvis::ApprovalNotifier>(value, selected);
            // Windows may re-advise during CredentialsChanged. Preserve the exact
            // unexpired signed request instead of silently superseding it here.
            if (initialized && !failed) {
                if (jarvis::milliseconds() >= expiry) start();
                else notifier->watch({jarvis::storePath() + L"\\responses\\" + std::wstring(requestId.begin(), requestId.end()) + L".sig", key, payload, requestId, expiry, sid});
                if (!approved) record("waiting");
            }
            return S_OK;
        } catch (...) { notifier.reset(); return E_FAIL; }
    }
    IFACEMETHODIMP UnAdvise() override { jarvis::publicTrace(sid, requestId, "provider-unadvised"); notifier.reset(); return S_OK; }
    IFACEMETHODIMP GetFieldDescriptorCount(DWORD* count) override { if (!count) return E_POINTER; *count = 3; return S_OK; }
    IFACEMETHODIMP GetFieldDescriptorAt(DWORD index, CREDENTIAL_PROVIDER_FIELD_DESCRIPTOR** out) override {
        if (!out) return E_POINTER; *out = nullptr; if (index > 2) return E_INVALIDARG;
        auto descriptor = static_cast<CREDENTIAL_PROVIDER_FIELD_DESCRIPTOR*>(CoTaskMemAlloc(sizeof(CREDENTIAL_PROVIDER_FIELD_DESCRIPTOR))); if (!descriptor) return E_OUTOFMEMORY;
        *descriptor = {}; descriptor->dwFieldID = index; descriptor->cpft = index == 0 ? CPFT_LARGE_TEXT : index == 1 ? CPFT_SMALL_TEXT : CPFT_SUBMIT_BUTTON;
        HRESULT hr = SHStrDupW(index == 0 ? L"JARVIS phone sign-in" : index == 1 ? L"Approve with your paired phone" : L"Check approval", &descriptor->pszLabel);
        if (FAILED(hr)) { CoTaskMemFree(descriptor); return hr; } *out = descriptor; return S_OK;
    }
    IFACEMETHODIMP GetCredentialCount(DWORD* count, DWORD* selected, BOOL* automatic) override {
        jarvis::publicTrace(sid, requestId, "enumerating");
        if (!count || !selected || !automatic) return E_POINTER; *count = 0; *selected = CREDENTIAL_PROVIDER_NO_DEFAULT; *automatic = FALSE;
        if (scenario == CPUS_INVALID) return S_OK;
        try { if (!initialized || (!failed && jarvis::milliseconds() >= expiry)) start(); poll(); if (!console()) return S_OK; *count = 1; if (approved && !failed) { *selected = 0; *automatic = TRUE; } } catch (...) {} return S_OK;
    }
    IFACEMETHODIMP GetCredentialAt(DWORD index, ICredentialProviderCredential** out) override;
    IFACEMETHODIMP SetUserArray(ICredentialProviderUserArray*) override { return S_OK; }
    IFACEMETHODIMP Advise(ICredentialProviderCredentialEvents*) override { return S_OK; }
    IFACEMETHODIMP SetSelected(BOOL* automatic) override { if (!automatic) return E_POINTER; *automatic = approved && !failed; return S_OK; }
    IFACEMETHODIMP SetDeselected() override { return S_OK; }
    IFACEMETHODIMP GetFieldState(DWORD index, CREDENTIAL_PROVIDER_FIELD_STATE* state, CREDENTIAL_PROVIDER_FIELD_INTERACTIVE_STATE* interactive) override { if (index > 2 || !state || !interactive) return E_INVALIDARG; *state = index ? CPFS_DISPLAY_IN_SELECTED_TILE : CPFS_DISPLAY_IN_BOTH; *interactive = CPFIS_NONE; return S_OK; }
    IFACEMETHODIMP GetStringValue(DWORD index, PWSTR* out) override { if (!out || index > 2) return E_INVALIDARG; return SHStrDupW(index == 0 ? L"JARVIS" : index == 1 ? failed ? L"Sign-in failed. Use your usual Windows PIN or password; update the native vault before trying again." : L"On your paired phone, open Laptop controls and approve Unlock. Your normal Windows sign-in remains available." : L"Check approval", out); }
    IFACEMETHODIMP GetBitmapValue(DWORD, HBITMAP*) override { return E_NOTIMPL; }
    IFACEMETHODIMP GetCheckboxValue(DWORD, BOOL*, PWSTR*) override { return E_NOTIMPL; }
    IFACEMETHODIMP GetSubmitButtonValue(DWORD index, DWORD* adjacent) override { if (index != 2 || !adjacent) return E_INVALIDARG; *adjacent = 1; return S_OK; }
    IFACEMETHODIMP GetComboBoxValueCount(DWORD, DWORD*, DWORD*) override { return E_NOTIMPL; }
    IFACEMETHODIMP GetComboBoxValueAt(DWORD, DWORD, PWSTR*) override { return E_NOTIMPL; }
    IFACEMETHODIMP SetStringValue(DWORD, PCWSTR) override { return E_NOTIMPL; }
    IFACEMETHODIMP SetCheckboxValue(DWORD, BOOL) override { return E_NOTIMPL; }
    IFACEMETHODIMP SetComboBoxSelectedValue(DWORD, DWORD) override { return E_NOTIMPL; }
    IFACEMETHODIMP CommandLinkClicked(DWORD) override { return E_NOTIMPL; }
    IFACEMETHODIMP GetSerialization(CREDENTIAL_PROVIDER_GET_SERIALIZATION_RESPONSE* response, CREDENTIAL_PROVIDER_CREDENTIAL_SERIALIZATION* output, PWSTR* text, CREDENTIAL_PROVIDER_STATUS_ICON* icon) override {
        if (!response || !output || !text || !icon) return E_POINTER; *response = CPGSR_NO_CREDENTIAL_NOT_FINISHED; *output = {}; *text = nullptr; *icon = CPSI_NONE;
        poll(); if (!approved || failed || !console() || jarvis::milliseconds() >= expiry) return S_OK;
        approved = false; failed = true; // One Windows attempt per signed phone approval.
        const char* stage = "receipt-failed";
        try {
            const auto path = jarvis::storePath() + L"\\receipts\\" + std::wstring(requestId.begin(), requestId.end()) + L".used";
            jarvis::saveFile(path, std::vector<BYTE>(payload.begin(), payload.end()), L"O:BAG:BAD:P(A;;FA;;;SY)(A;;FA;;;BA)", true);
            stage = "vault-failed";
            auto vault = jarvis::readVault(); if (vault.sid != sid || vault.computer != computer || vault.publicKey != key) { record("vault-changed"); return E_ACCESSDENIED; }
            stage = "pack-failed";
            DWORD length{}; CredPackAuthenticationBufferW(0, vault.account.data(), vault.password.data(), nullptr, &length); if (GetLastError() != ERROR_INSUFFICIENT_BUFFER || !length || length > 65536) { record(stage, GetLastError()); return E_FAIL; }
            auto data = static_cast<BYTE*>(CoTaskMemAlloc(length)); if (!data) return E_OUTOFMEMORY;
            if (!CredPackAuthenticationBufferW(0, vault.account.data(), vault.password.data(), data, &length)) { const DWORD code = GetLastError(); SecureZeroMemory(data, length); CoTaskMemFree(data); record(stage, code); return E_FAIL; }
            LSA_HANDLE lsa{}; ULONG package{}; char negotiate[] = "Negotiate"; LSA_STRING name{ 9,10,negotiate };
            const auto connectStatus = LsaConnectUntrusted(&lsa);
            if (connectStatus != 0) { SecureZeroMemory(data, length); CoTaskMemFree(data); record("lsa-connect-failed", LsaNtStatusToWinError(connectStatus)); return E_FAIL; }
            const auto status = LsaLookupAuthenticationPackage(lsa, &name, &package); LsaDeregisterLogonProcess(lsa);
            if (status != 0) { SecureZeroMemory(data, length); CoTaskMemFree(data); record("lsa-package-failed", LsaNtStatusToWinError(status)); return E_FAIL; }
            output->ulAuthenticationPackage = package; output->clsidCredentialProvider = providerId; output->cbSerialization = length; output->rgbSerialization = data; *response = CPGSR_RETURN_CREDENTIAL_FINISHED; record("credential-submitted"); return S_OK;
        } catch (...) { record(stage, GetLastError()); return E_FAIL; }
    }
    IFACEMETHODIMP ReportResult(NTSTATUS status, NTSTATUS, PWSTR* text, CREDENTIAL_PROVIDER_STATUS_ICON* icon) override { if (!text || !icon) return E_POINTER; *text = nullptr; *icon = status ? CPSI_ERROR : CPSI_SUCCESS; failed = true; approved = false; record(status ? "windows-rejected" : "windows-accepted", LsaNtStatusToWinError(status)); return S_OK; }
    IFACEMETHODIMP GetUserSid(PWSTR* out) override { if (!out) return E_POINTER; *out = nullptr; return sid.empty() ? E_UNEXPECTED : SHStrDupW(sid.c_str(), out); }
};
// Provider and tile have separate callback lifetimes. LogonUI unadvising an old
// tile during enumeration must not stop the provider's phone listener.
class Credential final : public ICredentialProviderCredential2 {
    std::atomic<ULONG> refs{1}; Provider* owner;
public:
    explicit Credential(Provider* value) : owner(value) { owner->AddRef(); }
    ~Credential() { owner->Release(); }
    IFACEMETHODIMP QueryInterface(REFIID iid, void** out) override { if (!out) return E_POINTER; *out = nullptr; if (iid != IID_IUnknown && iid != IID_ICredentialProviderCredential && iid != IID_ICredentialProviderCredential2) return E_NOINTERFACE; *out = static_cast<ICredentialProviderCredential2*>(this); AddRef(); return S_OK; }
    IFACEMETHODIMP_(ULONG) AddRef() override { return ++refs; }
    IFACEMETHODIMP_(ULONG) Release() override { const auto left = --refs; if (!left) delete this; return left; }
    IFACEMETHODIMP Advise(ICredentialProviderCredentialEvents*) override { return S_OK; }
    IFACEMETHODIMP UnAdvise() override { return S_OK; }
    IFACEMETHODIMP SetSelected(BOOL* value) override { return owner->SetSelected(value); }
    IFACEMETHODIMP SetDeselected() override { return owner->SetDeselected(); }
    IFACEMETHODIMP GetFieldState(DWORD id, CREDENTIAL_PROVIDER_FIELD_STATE* state, CREDENTIAL_PROVIDER_FIELD_INTERACTIVE_STATE* interactive) override { return owner->GetFieldState(id, state, interactive); }
    IFACEMETHODIMP GetStringValue(DWORD id, PWSTR* out) override { return owner->GetStringValue(id, out); }
    IFACEMETHODIMP GetBitmapValue(DWORD id, HBITMAP* out) override { return owner->GetBitmapValue(id, out); }
    IFACEMETHODIMP GetCheckboxValue(DWORD id, BOOL* value, PWSTR* label) override { return owner->GetCheckboxValue(id, value, label); }
    IFACEMETHODIMP GetSubmitButtonValue(DWORD id, DWORD* adjacent) override { return owner->GetSubmitButtonValue(id, adjacent); }
    IFACEMETHODIMP GetComboBoxValueCount(DWORD id, DWORD* count, DWORD* selected) override { return owner->GetComboBoxValueCount(id, count, selected); }
    IFACEMETHODIMP GetComboBoxValueAt(DWORD id, DWORD item, PWSTR* out) override { return owner->GetComboBoxValueAt(id, item, out); }
    IFACEMETHODIMP SetStringValue(DWORD id, PCWSTR value) override { return owner->SetStringValue(id, value); }
    IFACEMETHODIMP SetCheckboxValue(DWORD id, BOOL value) override { return owner->SetCheckboxValue(id, value); }
    IFACEMETHODIMP SetComboBoxSelectedValue(DWORD id, DWORD value) override { return owner->SetComboBoxSelectedValue(id, value); }
    IFACEMETHODIMP CommandLinkClicked(DWORD id) override { return owner->CommandLinkClicked(id); }
    IFACEMETHODIMP GetSerialization(CREDENTIAL_PROVIDER_GET_SERIALIZATION_RESPONSE* response, CREDENTIAL_PROVIDER_CREDENTIAL_SERIALIZATION* value, PWSTR* text, CREDENTIAL_PROVIDER_STATUS_ICON* icon) override { return owner->GetSerialization(response, value, text, icon); }
    IFACEMETHODIMP ReportResult(NTSTATUS status, NTSTATUS sub, PWSTR* text, CREDENTIAL_PROVIDER_STATUS_ICON* icon) override { return owner->ReportResult(status, sub, text, icon); }
    IFACEMETHODIMP GetUserSid(PWSTR* out) override { return owner->GetUserSid(out); }
};
HRESULT Provider::GetCredentialAt(DWORD index, ICredentialProviderCredential** out) { if (!out) return E_POINTER; *out = nullptr; if (index || !initialized) return E_INVALIDARG; *out = new(std::nothrow) Credential(this); return *out ? S_OK : E_OUTOFMEMORY; }
class Factory final : public IClassFactory {
    std::atomic<ULONG> refs{1};
public:
    Factory() { objects++; } ~Factory() { objects--; }
    IFACEMETHODIMP QueryInterface(REFIID iid, void** out) override { if (!out) return E_POINTER; *out = nullptr; if (iid != IID_IUnknown && iid != IID_IClassFactory) return E_NOINTERFACE; *out = this; AddRef(); return S_OK; }
    IFACEMETHODIMP_(ULONG) AddRef() override { return ++refs; }
    IFACEMETHODIMP_(ULONG) Release() override { auto remaining = --refs; if (!remaining) delete this; return remaining; }
    IFACEMETHODIMP CreateInstance(IUnknown* outer, REFIID iid, void** out) override { if (outer) return CLASS_E_NOAGGREGATION; if (!out) return E_POINTER; auto value = new(std::nothrow) Provider(); if (!value) return E_OUTOFMEMORY; const auto hr = value->QueryInterface(iid, out); value->Release(); return hr; }
    IFACEMETHODIMP LockServer(BOOL lock) override { if (lock) objects++; else objects--; return S_OK; }
};
STDAPI DllCanUnloadNow() { return objects == 0 && jarvis::activeApprovalNotifiers() == 0 ? S_OK : S_FALSE; }
STDAPI DllGetClassObject(REFCLSID clsid, REFIID iid, void** out) { if (clsid != providerId) return CLASS_E_CLASSNOTAVAILABLE; auto value = new(std::nothrow) Factory(); if (!value) return E_OUTOFMEMORY; auto hr = value->QueryInterface(iid, out); value->Release(); return hr; }

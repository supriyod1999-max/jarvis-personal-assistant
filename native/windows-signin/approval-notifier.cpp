#include "approval-notifier.hpp"
#include "vault.hpp"
#include <atomic>
#include <mutex>
#include <stdexcept>
namespace jarvis {
static std::atomic<long> active{};
struct ApprovalNotifier::State {
    HANDLE stopped{}; ICredentialProviderEvents* events{}; UINT_PTR context{};
    std::mutex mutex; PublicApprovalWatch current;
    State() { stopped = CreateEventW(nullptr, TRUE, FALSE, nullptr); if (!stopped) throw std::runtime_error("Notification event unavailable."); active++; }
    ~State() { if (events) events->Release(); CloseHandle(stopped); active--; }
};
ApprovalNotifier::ApprovalNotifier(ICredentialProviderEvents* events, UINT_PTR context) {
    auto selected = std::make_shared<State>(); selected->context = context;
    // CredentialsChanged is Windows' asynchronous external-event callback. Follow
    // Microsoft's hardware-event provider pattern: retain it and call from the
    // event worker, without requiring an IMarshal proxy or a UI message pump.
    selected->events = events; events->AddRef();
    // Pin the containing module until the worker has fully exited; a COM unload
    // check racing the worker's last shared state release cannot unload its code.
    HMODULE module{};
    if (!GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS, reinterpret_cast<LPCWSTR>(&active), &module)) throw std::runtime_error("Notification module unavailable.");
    struct Run { std::shared_ptr<State> state; HMODULE module; };
    auto run = new Run{selected, module};
    HANDLE thread = CreateThread(nullptr, 0, [](void* parameter) -> DWORD {
        auto execution = static_cast<Run*>(parameter); auto currentState = execution->state.get();
        {
            std::string notified, observed, lastNotice;
            while (WaitForSingleObject(currentState->stopped, 200) == WAIT_TIMEOUT) {
                PublicApprovalWatch value;
                { std::lock_guard lock(currentState->mutex); value = currentState->current; }
                if (value.requestId.empty() || value.requestId == notified) continue;
                auto notice = [&](const char* phase, HRESULT code = S_OK) {
                    if (value.ownerSid.empty() || lastNotice == value.requestId + phase) return;
                    try {
                        publicTrace(value.ownerSid, value.requestId, phase, static_cast<unsigned long>(code));
                        const std::string body = "JARVIS_WINDOWS_NOTIFY_V1\n" + value.requestId + "\n" + phase + "\n" + std::to_string(static_cast<unsigned long>(code)) + "\n" + std::to_string(value.expiresAt);
                        saveFile(storePath() + L"\\notification.txt", std::vector<BYTE>(body.begin(), body.end()), L"O:BAG:BAD:P(A;;FA;;;SY)(A;;FA;;;BA)(A;;GR;;;" + value.ownerSid + L")");
                        lastNotice = value.requestId + phase;
                    } catch (...) {}
                };
                if (observed != value.requestId) { observed = value.requestId; notice("watching"); }
                bool changed = milliseconds() >= value.expiresAt;
                if (!changed) try {
                    const auto bytes = readFile(value.signaturePath, 512);
                    changed = verifyPhone(value.key, value.payload, std::string(bytes.begin(), bytes.end()));
                    if (!changed) notice("signature-rejected");
                } catch (...) { /* A missing or invalid public proof never approves anything. */ }
                if (changed && WaitForSingleObject(currentState->stopped, 0) == WAIT_TIMEOUT) {
                    notified = value.requestId;
                    const auto result = currentState->events->CredentialsChanged(currentState->context);
                    notice(SUCCEEDED(result) ? "notified" : "notification-failed", result);
                }
            }
        }
        const auto pinned = execution->module; delete execution;
        FreeLibraryAndExitThread(pinned, 0);
    }, run, 0, nullptr);
    if (!thread) { delete run; FreeLibrary(module); throw std::runtime_error("Notification worker unavailable."); }
    CloseHandle(thread);
    state = std::move(selected);
}
ApprovalNotifier::~ApprovalNotifier() { if (state) SetEvent(state->stopped); }
void ApprovalNotifier::watch(PublicApprovalWatch value) { std::lock_guard lock(state->mutex); state->current = std::move(value); }
long activeApprovalNotifiers() { return active.load(); }
}

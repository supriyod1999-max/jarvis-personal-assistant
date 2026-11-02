#include "approval-notifier.hpp"
#include "vault.hpp"
#include <atomic>
#include <iostream>
#include <thread>
#include <sstream>
class Sink final : public ICredentialProviderEvents {
    std::atomic<ULONG> refs{1};
public:
    std::atomic<unsigned> calls{}; UINT_PTR expected{73};
    IFACEMETHODIMP QueryInterface(REFIID iid, void** out) override { if (!out) return E_POINTER; *out = nullptr; if (iid != IID_IUnknown && iid != IID_ICredentialProviderEvents) return E_NOINTERFACE; *out = static_cast<ICredentialProviderEvents*>(this); AddRef(); return S_OK; }
    IFACEMETHODIMP_(ULONG) AddRef() override { return ++refs; }
    IFACEMETHODIMP_(ULONG) Release() override { const auto left = --refs; if (!left) delete this; return left; }
    IFACEMETHODIMP CredentialsChanged(UINT_PTR context) override { if (context != expected) return E_INVALIDARG; calls++; return S_OK; }
};
int wmain(int argc, wchar_t** argv) {
    if (FAILED(CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED))) return 1;
    int result = 1; Sink* sink{};
    try {
        sink = new Sink();
        {
            jarvis::ApprovalNotifier notifier(sink, sink->expected);
            jarvis::PublicApprovalWatch watch; watch.requestId = "synthetic-expiry"; watch.expiresAt = jarvis::milliseconds() - 1;
            if (argc == 2) {
                const auto bytes = jarvis::readFile(argv[1], 8192); std::istringstream input(std::string(bytes.begin(), bytes.end())); std::string encoded;
                if (!std::getline(input, watch.key) || !std::getline(input, encoded)) throw 1;
                const auto body = jarvis::unbase64(encoded); watch.payload.assign(body.begin(), body.end());
                watch.signaturePath = std::wstring(argv[1]) + L".sig";
                watch.expiresAt = jarvis::milliseconds() + 5000;
            } else if (argc != 1) throw 1;
            notifier.watch(watch);
            // Deliberately no GetMessage/DispatchMessage/UI timer pump.
            for (int i = 0; i < 40 && sink->calls == 0; ++i) std::this_thread::sleep_for(std::chrono::milliseconds(50));
            if (sink->calls != 1) throw 1;
            std::this_thread::sleep_for(std::chrono::milliseconds(450)); if (sink->calls != 1) throw 1;
        }
        for (int i = 0; i < 40 && jarvis::activeApprovalNotifiers(); ++i) std::this_thread::sleep_for(std::chrono::milliseconds(25));
        if (jarvis::activeApprovalNotifiers()) throw 1;
        result = 0; std::cout << "Public approval notification works without a UI message pump, notifies once and stops cleanly. No vault or Windows authentication used.\n";
    } catch (...) { std::cerr << "Public approval notification test failed.\n"; }
    if (sink) sink->Release(); CoUninitialize(); return result;
}

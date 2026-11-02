#pragma once
#include <credentialprovider.h>
#include <memory>
#include <string>
namespace jarvis {
struct PublicApprovalWatch { std::wstring signaturePath; std::string key, payload, requestId; long long expiresAt{}; std::wstring ownerSid; };
// Watches only public proof. Credential verification and serialization remain on
// the provider's apartment. No dependency on LogonUI pumping WM_TIMER messages.
class ApprovalNotifier {
    struct State; std::shared_ptr<State> state;
public:
    ApprovalNotifier(ICredentialProviderEvents* events, UINT_PTR context);
    ~ApprovalNotifier();
    void watch(PublicApprovalWatch value);
};
long activeApprovalNotifiers();
}

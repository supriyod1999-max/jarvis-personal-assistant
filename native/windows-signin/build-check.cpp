// Toolchain acceptance only. This program never reads Windows credentials,
// registers a provider, installs a service, locks, unlocks or signs in a user.
#include <windows.h>
#include <credentialprovider.h>
#include <bcrypt.h>
#include <wincrypt.h>
#include <array>
#include <iostream>
#include <type_traits>
#include <vector>

static_assert(std::is_abstract_v<ICredentialProvider>);
static_assert(std::is_abstract_v<ICredentialProviderCredential2>);
static_assert(std::is_abstract_v<ICredentialProviderSetUserArray>);

struct Algorithm {
    BCRYPT_ALG_HANDLE handle{};
    ~Algorithm() { if (handle) BCryptCloseAlgorithmProvider(handle, 0); }
};
struct Key {
    BCRYPT_KEY_HANDLE handle{};
    ~Key() { if (handle) BCryptDestroyKey(handle); }
};
bool cryptoCheck() {
    Algorithm sha, rsa;
    Key key;
    if (BCryptOpenAlgorithmProvider(&sha.handle, BCRYPT_SHA256_ALGORITHM, nullptr, 0) < 0
        || BCryptOpenAlgorithmProvider(&rsa.handle, BCRYPT_RSA_ALGORITHM, nullptr, 0) < 0
        || BCryptGenerateKeyPair(rsa.handle, &key.handle, 2048, 0) < 0
        || BCryptFinalizeKeyPair(key.handle, 0) < 0) return false;
    // Ephemeral synthetic data exercises the same RSA/SHA-256 primitive as the
    // phone approval contract. No test key is enrolled or saved.
    std::array<UCHAR, 32> digest{};
    std::array<UCHAR, 24> data{};
    if (BCryptHash(sha.handle, nullptr, 0, data.data(), static_cast<ULONG>(data.size()),
        digest.data(), static_cast<ULONG>(digest.size())) < 0) return false;
    BCRYPT_PKCS1_PADDING_INFO padding{ BCRYPT_SHA256_ALGORITHM };
    ULONG size{};
    if (BCryptSignHash(key.handle, &padding, digest.data(), static_cast<ULONG>(digest.size()),
        nullptr, 0, &size, BCRYPT_PAD_PKCS1) < 0) return false;
    std::vector<UCHAR> signature(size);
    if (BCryptSignHash(key.handle, &padding, digest.data(), static_cast<ULONG>(digest.size()),
        signature.data(), size, &size, BCRYPT_PAD_PKCS1) < 0) return false;
    if (BCryptVerifySignature(key.handle, &padding, digest.data(), static_cast<ULONG>(digest.size()),
        signature.data(), size, BCRYPT_PAD_PKCS1) < 0) return false;
    digest[0] ^= 1;
    return BCryptVerifySignature(key.handle, &padding, digest.data(), static_cast<ULONG>(digest.size()),
        signature.data(), size, BCRYPT_PAD_PKCS1) < 0;
}
bool protectionCheck() {
    std::array<BYTE, 24> synthetic{};
    DATA_BLOB input{ static_cast<DWORD>(synthetic.size()), synthetic.data() }, encrypted{}, decrypted{};
    if (!CryptProtectData(&input, L"JARVIS synthetic build check", nullptr, nullptr, nullptr,
        CRYPTPROTECT_UI_FORBIDDEN, &encrypted)) return false;
    const bool opened = CryptUnprotectData(&encrypted, nullptr, nullptr, nullptr, nullptr,
        CRYPTPROTECT_UI_FORBIDDEN, &decrypted) != FALSE;
    const bool match = opened && decrypted.cbData == input.cbData
        && memcmp(decrypted.pbData, input.pbData, input.cbData) == 0;
    if (decrypted.pbData) { SecureZeroMemory(decrypted.pbData, decrypted.cbData); LocalFree(decrypted.pbData); }
    if (encrypted.pbData) { SecureZeroMemory(encrypted.pbData, encrypted.cbData); LocalFree(encrypted.pbData); }
    return match;
}
int main() {
    if (!cryptoCheck() || !protectionCheck()) {
        std::cerr << "Native prerequisite verification failed.\n"; return 1;
    }
    std::cout << "Credential Provider V2 headers, RSA/SHA-256 verification, tamper rejection and synthetic DPAPI round-trip passed.\n";
    return 0;
}

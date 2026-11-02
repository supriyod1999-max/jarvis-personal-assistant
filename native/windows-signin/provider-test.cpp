#include <windows.h>
#include <credentialprovider.h>
#include <iostream>
int wmain(int argc, wchar_t** argv) {
    if (argc != 2 || FAILED(CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED))) return 1;
    HMODULE dll = LoadLibraryExW(argv[1], nullptr, LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_DEFAULT_DIRS); if (!dll) return 1;
    auto factoryFunction = reinterpret_cast<LPFNGETCLASSOBJECT>(GetProcAddress(dll, "DllGetClassObject"));
    auto unloaded = reinterpret_cast<LPFNCANUNLOADNOW>(GetProcAddress(dll, "DllCanUnloadNow"));
    constexpr CLSID id{ 0x981119e4,0x88bd,0x4f29,{0xa9,0xba,0xc1,0xa8,0x96,0x8b,0xe1,0x0e} };
    IClassFactory* factory{}; ICredentialProvider* provider{}; ICredentialProviderCredential2* credential{}; int result = 1;
    if (factoryFunction && unloaded && SUCCEEDED(factoryFunction(id, IID_PPV_ARGS(&factory))) && SUCCEEDED(factory->CreateInstance(nullptr, IID_PPV_ARGS(&provider))) && SUCCEEDED(provider->QueryInterface(IID_PPV_ARGS(&credential)))) {
        DWORD count{}; CREDENTIAL_PROVIDER_CREDENTIAL_SERIALIZATION serialized{}; CREDENTIAL_PROVIDER_GET_SERIALIZATION_RESPONSE response{}; PWSTR text{}; CREDENTIAL_PROVIDER_STATUS_ICON icon{};
        // Never call GetCredentialCount: it would read a live enrollment. These
        // interface checks never read a vault, create a challenge or authenticate.
        const bool safe = provider->SetUsageScenario(CPUS_CREDUI, 0) == E_NOTIMPL && SUCCEEDED(provider->SetUsageScenario(CPUS_LOGON, 0))
            && SUCCEEDED(provider->GetFieldDescriptorCount(&count)) && count == 3
            && SUCCEEDED(credential->GetSerialization(&response, &serialized, &text, &icon)) && response == CPGSR_NO_CREDENTIAL_NOT_FINISHED && !serialized.rgbSerialization && !serialized.cbSerialization;
        if (safe) result = 0;
    }
    if (credential) credential->Release(); if (provider) provider->Release(); if (factory) factory->Release();
    if (!unloaded || unloaded() != S_OK) result = 1; FreeLibrary(dll); CoUninitialize();
    std::cout << (result ? "Provider interface test failed.\n" : "Provider V2 interfaces and rejection without phone approval passed. No vault or Windows authentication touched.\n"); return result;
}

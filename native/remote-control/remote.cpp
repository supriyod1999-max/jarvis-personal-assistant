#include <windows.h>
#include <iostream>
#include <string>
#include <vector>
#include <charconv>
#include <map>

struct Command { unsigned long long sequence=0; std::string type,text; int a=0,b=0; };
bool number(const std::string& text,int& value){auto result=std::from_chars(text.data(),text.data()+text.size(),value);return result.ec==std::errc()&&result.ptr==text.data()+text.size();}
int nibble(char value){if(value>='0'&&value<='9')return value-'0';if(value>='a'&&value<='f')return value-'a'+10;return -1;}
bool parse(const std::string& line,Command& command){
    if(line.size()>10000)return false;std::vector<std::string> fields;size_t begin=0;
    for(size_t index=0;index<=line.size();++index)if(index==line.size()||line[index]=='|'){fields.push_back(line.substr(begin,index-begin));begin=index+1;}
    if(fields.size()!=5||fields[0].empty())return false;
    auto result=std::from_chars(fields[0].data(),fields[0].data()+fields[0].size(),command.sequence);
    if(result.ec!=std::errc()||result.ptr!=fields[0].data()+fields[0].size()||command.sequence==0||!number(fields[2],command.a)||!number(fields[3],command.b)||fields[4].size()%2)return false;
    command.type=fields[1];command.text.clear();
    for(size_t index=0;index<fields[4].size();index+=2){int a=nibble(fields[4][index]),b=nibble(fields[4][index+1]);if(a<0||b<0)return false;command.text.push_back(static_cast<char>(a*16+b));}
    if(command.type=="move")return command.text.empty()&&command.a>=-600&&command.a<=600&&command.b>=-600&&command.b<=600;
    if(command.type=="scroll")return command.text.empty()&&command.b==0&&command.a>=-10&&command.a<=10&&command.a!=0;
    if(command.a!=0||command.b!=0)return false;
    if(command.type=="click")return command.text=="left"||command.text=="right";
    if(command.type=="key")return command.text=="enter"||command.text=="backspace"||command.text=="tab"||command.text=="escape"||command.text=="left"||command.text=="right"||command.text=="up"||command.text=="down"||command.text=="space";
    if(command.type=="media")return command.text=="play-pause"||command.text=="next"||command.text=="previous"||command.text=="stop"||command.text=="volume-up"||command.text=="volume-down"||command.text=="mute";
    if(command.type=="text"){
        if(command.text.empty()||command.text.size()>2048)return false;
        for(unsigned char value:command.text)if(value<32||value==127)return false;
        return MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,command.text.data(),static_cast<int>(command.text.size()),nullptr,0)>0;
    }
    return false;
}
bool interactive(){
    DWORD session=0;if(!ProcessIdToSessionId(GetCurrentProcessId(),&session)||session==0||session!=WTSGetActiveConsoleSessionId())return false;
    HDESK desktop=OpenInputDesktop(0,FALSE,DESKTOP_READOBJECTS);if(!desktop)return false;
    wchar_t name[256]{};DWORD needed=0;bool allowed=GetUserObjectInformationW(desktop,UOI_NAME,name,sizeof(name),&needed)&&std::wstring(name)==L"Default";CloseDesktop(desktop);return allowed;
}
INPUT mouse(DWORD flags,LONG x=0,LONG y=0,DWORD data=0){INPUT input{};input.type=INPUT_MOUSE;input.mi.dwFlags=flags;input.mi.dx=x;input.mi.dy=y;input.mi.mouseData=data;return input;}
INPUT key(WORD value,bool up,bool unicode=false){INPUT input{};input.type=INPUT_KEYBOARD;if(unicode){input.ki.wScan=value;input.ki.dwFlags=KEYEVENTF_UNICODE;}else input.ki.wVk=value;if(up)input.ki.dwFlags|=KEYEVENTF_KEYUP;return input;}
bool apply(const Command& command){
    if(!interactive())return false;std::vector<INPUT> events;
    if(command.type=="move")events.push_back(mouse(MOUSEEVENTF_MOVE,command.a,command.b));
    else if(command.type=="scroll")events.push_back(mouse(MOUSEEVENTF_WHEEL,0,0,static_cast<DWORD>(command.a*WHEEL_DELTA)));
    else if(command.type=="click"){bool left=command.text=="left";events.push_back(mouse(left?MOUSEEVENTF_LEFTDOWN:MOUSEEVENTF_RIGHTDOWN));events.push_back(mouse(left?MOUSEEVENTF_LEFTUP:MOUSEEVENTF_RIGHTUP));}
    else if(command.type=="text"){
        int count=MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,command.text.data(),static_cast<int>(command.text.size()),nullptr,0);if(count<1||count>1024)return false;
        std::wstring text(static_cast<size_t>(count),L'\0');MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,command.text.data(),static_cast<int>(command.text.size()),text.data(),count);
        for(wchar_t value:text){events.push_back(key(static_cast<WORD>(value),false,true));events.push_back(key(static_cast<WORD>(value),true,true));}SecureZeroMemory(text.data(),text.size()*sizeof(wchar_t));
    }else{
        static const std::map<std::string,int> codes={{"enter",VK_RETURN},{"backspace",VK_BACK},{"tab",VK_TAB},{"escape",VK_ESCAPE},{"left",VK_LEFT},{"right",VK_RIGHT},{"up",VK_UP},{"down",VK_DOWN},{"space",VK_SPACE},{"play-pause",VK_MEDIA_PLAY_PAUSE},{"next",VK_MEDIA_NEXT_TRACK},{"previous",VK_MEDIA_PREV_TRACK},{"stop",VK_MEDIA_STOP},{"volume-up",VK_VOLUME_UP},{"volume-down",VK_VOLUME_DOWN},{"mute",VK_VOLUME_MUTE}};
        auto code=codes.find(command.text);if(code==codes.end())return false;events.push_back(key(static_cast<WORD>(code->second),false));events.push_back(key(static_cast<WORD>(code->second),true));
    }
    return !events.empty()&&SendInput(static_cast<UINT>(events.size()),events.data(),sizeof(INPUT))==events.size();
}
int main(int argc,char** argv){
    if(argc==2&&std::string(argv[1])=="--self-test"){
        Command value;bool ok=parse("1|move|12|-13|",value)&&!parse("2|move|99999|0|",value)&&!parse("3|shell|0|0|",value)&&parse("4|text|0|0|48656c6c6f",value)&&!parse("5|text|0|0|0a",value)&&!parse("6|text|0|0|ff",value);std::cout<<"{\"ok\":"<<(ok?"true":"false")<<"}\n";return ok?0:1;
    }
    if(argc==2&&std::string(argv[1])=="--status"){std::cout<<"{\"interactive\":"<<(interactive()?"true":"false")<<"}\n";return 0;}
    unsigned long long last=0;std::string line;
    while(std::getline(std::cin,line)){
        Command command;bool valid=parse(line,command),applied=false;if(valid&&command.sequence>last){last=command.sequence;applied=apply(command);}
        std::cout<<"{\"sequence\":"<<command.sequence<<",\"applied\":"<<(applied?"true":"false")<<"}\n"<<std::flush;
        if(!command.text.empty())SecureZeroMemory(command.text.data(),command.text.size());if(!line.empty())SecureZeroMemory(line.data(),line.size());
    }
    return 0;
}

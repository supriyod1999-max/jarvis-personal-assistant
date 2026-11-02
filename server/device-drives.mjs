import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run=promisify(execFile);
// Fixed native metadata query. No caller path, command or script is executed.
export async function windowsDrives(){
  const script="[System.IO.DriveInfo]::GetDrives() | Where-Object { $_.IsReady } | ForEach-Object { [pscustomobject]@{ id=('drive-'+$_.Name.Substring(0,1).ToLower()); path=$_.RootDirectory.FullName; label=($_.Name+' '+$_.VolumeLabel).Trim() } } | ConvertTo-Json -Compress";
  const {stdout}=await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,timeout:7000,maxBuffer:16000});
  const rows=JSON.parse(stdout||'[]');return(Array.isArray(rows)?rows:[rows]).filter(row=>/^[a-zA-Z]:\\$/.test(row.path)&&/^drive-[a-z]$/.test(row.id)).slice(0,26);
}

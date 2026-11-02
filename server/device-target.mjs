/** Match only enrolled exact names or explicit device classes. Never fuzzy-select a recipient. */
export function resolveDeviceTarget(text,devices){
  const normalize=v=>String(v||'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
  const value=normalize(text);
  const named=devices.filter(d=>normalize(d.name)&&(` ${value} `).includes(` ${normalize(d.name)} `));
  if(named.length===1)return {device:named[0]};
  if(named.length>1)return {clarification:'Which device should I use? '+named.map(d=>d.name).join(', ')};
  const phone=/\b(?:phone|mobile|android)\b/.test(value),computer=/\b(?:laptop|computer|pc|desktop)\b/.test(value),watch=/\bwatch\b/.test(value);
  if([phone,computer,watch].filter(Boolean).length>1)return {clarification:'Choose the source device and destination in the transfer review. Nothing has been transferred.'};
  if(!phone&&!computer&&!watch)return {};
  const matches=devices.filter(d=>phone?d.kind==='android':watch?d.kind==='watch':d.role==='host');
  if(matches.length===1)return {device:matches[0]};
  return {clarification:matches.length?'Which device do you mean? '+matches.map(d=>d.name).join(', '):'That device is not enrolled for this action. Open Devices to check its available features.'};
}

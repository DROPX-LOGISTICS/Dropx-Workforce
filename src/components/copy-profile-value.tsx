'use client';
import {useState} from 'react';
export function CopyProfileValue({label,value}:{label:string;value:string}){
 const [notice,setNotice]=useState('');
 return <div className="wf-copy-field"><small>{label}</small><span>{value||'Not submitted'}</span>{value?<button type="button" aria-label={`Copy ${label}`} onClick={async()=>{try{await navigator.clipboard.writeText(value);setNotice('Copied');}catch{setNotice('Select the text to copy');}}}>Copy</button>:null}<small role="status">{notice}</small></div>;
}

import {spawn} from "node:child_process";
import {existsSync} from "node:fs";
import {join} from "node:path";
const cli=process.env.STUDIO_CLAUDE_ENTRY||join(process.env.APPDATA||"","npm","node_modules","@anthropic-ai","claude-code","cli.js");
if(!existsSync(cli)){console.error("Claude Code entrypoint not found. Set STUDIO_CLAUDE_ENTRY.");process.exit(3);}
const prompt=process.argv[2];
if(!prompt){console.error("No claimed framework task supplied.");process.exit(2);}
const extra="You are running an authorised, bounded integration proof. Read AGENT_APP.md, then use the bundled a2app CLI to inspect this request and its evidence and call submit-proof-result. Do not edit source, start other agents or print credentials. Use only node commands against this app. Do not claim CraftBot compatibility from the local-execution receipt.";
const child=spawn(process.execPath,[cli,"-p",prompt,"--append-system-prompt",extra,"--output-format","json","--tools","Read,Bash","--allowedTools","Read","Bash(node:*)"],{
 cwd:process.cwd(),env:process.env,stdio:["ignore","pipe","pipe"],windowsHide:true,
});
let output="",error="";
child.stdout.on("data",d=>{output=(output+d).slice(-30000);});
child.stderr.on("data",d=>{error=(error+d).slice(-5000);});
child.on("error",()=>{console.error("Claude Code could not start.");process.exitCode=3;});
child.on("close",code=>{
 let result;
 try{result=JSON.parse(output.trim());}catch{}
 // Report only the harness envelope, not conversations, tool output or secrets.
 console.log(JSON.stringify({harness:"claude-code",exitCode:code,isError:result?.is_error??null,turns:result?.num_turns??null,permissionDenials:result?.permission_denials?.length??null}));
 if(code!==0||result?.is_error)console.error("The real Claude run did not succeed. Check the harness authentication, permissions and model availability.");
 process.exitCode=code|| (result?.is_error?1:0);
});

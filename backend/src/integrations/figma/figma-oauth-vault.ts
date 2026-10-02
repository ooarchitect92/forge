import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { AppError } from "../../utils/app-error.js";

function key():Buffer{
  const raw=process.env.FIGMA_OAUTH_STATE_ENCRYPTION_KEY;
  if(!raw) throw new AppError("Figma OAuth state encryption is not configured",503,"FIGMA_OAUTH_NOT_CONFIGURED");
  const value=Buffer.from(raw,"base64");
  if(value.length!==32) throw new AppError("Figma OAuth state encryption is not configured",503,"FIGMA_OAUTH_NOT_CONFIGURED");
  return value;
}
export function encryptFigmaOAuthState(value:string):string{
  const iv=randomBytes(12);
  const cipher=createCipheriv("aes-256-gcm",key(),iv);
  const encrypted=Buffer.concat([cipher.update(value,"utf8"),cipher.final()]);
  return `${iv.toString("base64") }.${cipher.getAuthTag().toString("base64")}.${encrypted.toString("base64")}`;
}
export function decryptFigmaOAuthState(value:string):string{
  const [iv,tag,data]=String(value||"").split(".");
  if(!iv||!tag||!data) throw new AppError("Stored Figma OAuth state is invalid",409,"FIGMA_OAUTH_STATE_INVALID");
  try{
    const decipher=createDecipheriv("aes-256-gcm",key(),Buffer.from(iv,"base64"));
    decipher.setAuthTag(Buffer.from(tag,"base64"));
    return Buffer.concat([decipher.update(Buffer.from(data,"base64")),decipher.final()]).toString("utf8");
  }catch{
    throw new AppError("Stored Figma OAuth state is invalid",409,"FIGMA_OAUTH_STATE_INVALID");
  }
}

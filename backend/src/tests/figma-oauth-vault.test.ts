import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { encryptFigmaOAuthState, decryptFigmaOAuthState } from "../integrations/figma/figma-oauth-vault.js";

test("Figma OAuth PKCE verifier is authenticated ciphertext",()=>{
  const previous=process.env.FIGMA_OAUTH_STATE_ENCRYPTION_KEY;
  process.env.FIGMA_OAUTH_STATE_ENCRYPTION_KEY=randomBytes(32).toString("base64");
  try{
    const value="pkce-verifier-private-value";
    const encrypted=encryptFigmaOAuthState(value);
    assert.notEqual(encrypted,value);
    assert.equal(encrypted.includes(value),false);
    assert.equal(decryptFigmaOAuthState(encrypted),value);
    const parts=encrypted.split(".");
    parts[2]=Buffer.from("tampered").toString("base64");
    assert.throws(()=>decryptFigmaOAuthState(parts.join(".")),{code:"FIGMA_OAUTH_STATE_INVALID"});
  }finally{
    if(previous===undefined) delete process.env.FIGMA_OAUTH_STATE_ENCRYPTION_KEY; else process.env.FIGMA_OAUTH_STATE_ENCRYPTION_KEY=previous;
  }
});

test("Figma OAuth state vault fails closed without a 32-byte key",()=>{
  const previous=process.env.FIGMA_OAUTH_STATE_ENCRYPTION_KEY;
  delete process.env.FIGMA_OAUTH_STATE_ENCRYPTION_KEY;
  try{assert.throws(()=>encryptFigmaOAuthState("value"),{code:"FIGMA_OAUTH_NOT_CONFIGURED"});}
  finally{if(previous!==undefined) process.env.FIGMA_OAUTH_STATE_ENCRYPTION_KEY=previous;}
});

// Adding, changing or removing a passcode: everything stored for the profile is re-encrypted to match.
import { current, updateProfile } from './accounts';
import { reencryptAll } from './store';
import { rewriteSecure } from './secure';
import { deriveKey, getKey, newSalt, sealText, setKey } from './vault';
import { scope } from './accounts';

const CANARY = 'simplycanva';

export const changePasscode = async (pass: string | null) => {
  const oldKey = getKey();
  let newKey: CryptoKey | null = null, salt: string | undefined, canary: string | undefined;
  if (pass) { salt = newSalt(); newKey = await deriveKey(pass, salt); canary = await sealText(CANARY, newKey); }
  await reencryptAll(oldKey, newKey);
  for (const k of ['canva-lite:presets', 'canva-lite:brand']) await rewriteSecure(scope(k), oldKey, newKey);
  updateProfile(current().id, { salt, canary });
  setKey(newKey);
};

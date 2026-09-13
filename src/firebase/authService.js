import { signInWithPopup, signOut } from "firebase/auth";
import { auth, googleProvider } from "./config";

export async function signInWithGoogle() {
  const result = await signInWithPopup(auth, googleProvider);
  return result.user;
}

export async function signOutUser() {
  await signOut(auth);
}

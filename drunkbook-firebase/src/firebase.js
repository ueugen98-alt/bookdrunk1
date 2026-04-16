import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyAMtpSMGFCvfkcxqj6Vt13qJs-FOTmTL24",
  authDomain: "drunkbook.firebaseapp.com",
  projectId: "drunkbook",
  storageBucket: "drunkbook.firebasestorage.app",
  messagingSenderId: "789487888011",
  appId: "1:789487888011:web:24f6fc1ffb97d7e1a7168e"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

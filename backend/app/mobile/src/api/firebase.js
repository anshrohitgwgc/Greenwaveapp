import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// You will get these keys from your Firebase Console project settings
const firebaseConfig = {
  apiKey: "AIzaSyDy5215SmfKAaF4ko0Grv8CS8-gcN-TsxQ",
  authDomain: "greenwave-892c0.firebaseapp.com",
  projectId: "greenwave-892c0",
  storageBucket: "greenwave-892c0.firebasestorage.app",
  messagingSenderId: "665591628884",
  appId: "1:665591628884:web:7ca17c1f494e154deb59c1"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Export Auth and Firestore to use in your screens
export const auth = getAuth(app);
export const db = getFirestore(app);
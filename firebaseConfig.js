import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "TU_API_KEY_REAL",
  authDomain: "el-chucho-apnea.firebaseapp.com",
  projectId: "el-chucho-apnea",
  storageBucket: "el-chucho-apnea.appspot.com",
  messagingSenderId: "1017391434779",
  appId: "TU_APP_ID_REAL"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
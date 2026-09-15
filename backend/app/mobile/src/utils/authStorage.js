import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const TOKEN_KEY = 'greenwave_token';
const USER_KEY = 'greenwave_user';

const isWeb = Platform.OS === 'web';

export async function saveToken(token) {
  if (isWeb) {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(TOKEN_KEY, token);
      }
    } catch (error) {
      console.warn('localStorage saveToken failed:', error);
    }
    return;
  }
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function getToken() {
  if (isWeb) {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        return window.localStorage.getItem(TOKEN_KEY);
      }
      return null;
    } catch (error) {
      console.warn('localStorage getToken failed:', error);
      return null;
    }
  }
  return await SecureStore.getItemAsync(TOKEN_KEY);
}

export async function removeToken() {
  if (isWeb) {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(TOKEN_KEY);
      }
    } catch (error) {
      console.warn('localStorage removeToken failed:', error);
    }
    return;
  }
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

export async function saveUser(user) {
  if (!user) return;
  const sanitizedUser = {
    id: user.id,
    fullName: user.fullName,
    username: user.username,
    email: user.email,
    role: user.role,
  };

  const jsonValue = JSON.stringify(sanitizedUser);

  if (isWeb) {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(USER_KEY, jsonValue);
      }
    } catch (error) {
      console.warn('localStorage saveUser failed:', error);
    }
    return;
  }
  await SecureStore.setItemAsync(USER_KEY, jsonValue);
}

export async function getUser() {
  let storedUser = null;
  if (isWeb) {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        storedUser = window.localStorage.getItem(USER_KEY);
      }
    } catch (error) {
      console.warn('localStorage getUser failed:', error);
      return null;
    }
  } else {
    storedUser = await SecureStore.getItemAsync(USER_KEY);
  }

  if (!storedUser) return null;
  try {
    return JSON.parse(storedUser);
  } catch (error) {
    console.warn('Failed to parse stored user:', error);
    return null;
  }
}

export async function removeUser() {
  if (isWeb) {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(USER_KEY);
      }
    } catch (error) {
      console.warn('localStorage removeUser failed:', error);
    }
    return;
  }
  await SecureStore.deleteItemAsync(USER_KEY);
}

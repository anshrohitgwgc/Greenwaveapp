import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import LoginScreen from './src/screens/auth/LoginScreen';

import AdminDashboard from './src/screens/admin/AdminDashboard';
import DriverDashboard from './src/screens/driver/DriverDashboard';
import TodayJobs from './src/screens/driver/TodayJobs';
import WeightEntry from './src/screens/driver/WeightEntry';
import ManagerDashboard from './src/screens/manager/ManagerDashboard';
import CreatePickup from './src/screens/staff/CreatePickup';
import PickupDetails from './src/screens/staff/PickupDetails';
import PickupHistory from './src/screens/staff/PickupHistory';
import StaffDashboard from './src/screens/staff/StaffDashboard';
import { getToken, getUser } from './src/utils/authStorage';

const Stack = createNativeStackNavigator();

function getInitialRouteForRole(role) {
  const normalized = (role || '').toLowerCase();
  switch (normalized) {
    case 'admin':
    case 'superadmin':
    case 'infraadmin':
      return 'AdminDashboard';
    case 'manager':
      return 'ManagerDashboard';
    case 'staff':
    case 'readonlyauditor':
      return 'StaffDashboard';
    case 'driver':
      return 'DriverDashboard';
    default:
      return 'Login';
  }
}

export default function App() {
  const [initialRoute, setInitialRoute] = useState(null);

  useEffect(() => {
    let isMounted = true;

    async function checkExistingSession() {
      try {
        const [token, user] = await Promise.all([getToken(), getUser()]);
        if (isMounted) {
          if (token && user && user.role) {
            setInitialRoute(getInitialRouteForRole(user.role));
          } else {
            setInitialRoute('Login');
          }
        }
      } catch (error) {
        console.warn('Session check failed:', error);
        if (isMounted) {
          setInitialRoute('Login');
        }
      }
    }

    checkExistingSession();

    return () => {
      isMounted = false;
    };
  }, []);

  if (!initialRoute) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#1B7A35" />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName={initialRoute}
        screenOptions={{
          headerShown: false,
          animation: 'fade',
        }}
      >
        <Stack.Screen
          name="Login"
          component={LoginScreen}
        />

        <Stack.Screen
          name="DriverDashboard"
          component={DriverDashboard}
        />

        <Stack.Screen
          name="TodayJobs"
          component={TodayJobs}
        />

        <Stack.Screen
          name="WeightEntry"
          component={WeightEntry}
        />

        <Stack.Screen
          name="ManagerDashboard"
          component={ManagerDashboard}
        />

        <Stack.Screen
          name="StaffDashboard"
          component={StaffDashboard}
        />

        <Stack.Screen
          name="CreatePickup"
          component={CreatePickup}
        />

        <Stack.Screen
          name="PickupHistory"
          component={PickupHistory}
        />

        <Stack.Screen
          name="PickupDetails"
          component={PickupDetails}
        />

        <Stack.Screen
          name="AdminDashboard"
          component={AdminDashboard}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: '#F4F8F5',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
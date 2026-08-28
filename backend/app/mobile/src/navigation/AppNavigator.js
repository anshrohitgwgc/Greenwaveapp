import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

// Saari screens yahan import karni hoti hain
import AdminDashboard from '../screens/admin/AdminDashboard';
import LoginScreen from '../screens/auth/LoginScreen';
import DriverDashboard from '../screens/driver/DriverDashboard';
import TodayJobs from '../screens/driver/TodayJobs';
import WeightEntry from '../screens/driver/WeightEntry';
import ManagerDashboard from '../screens/manager/ManagerDashboard';
import CreatePickup from '../screens/staff/CreatePickup';
import PickupDetails from '../screens/staff/PickupDetails';
import PickupHistory from '../screens/staff/PickupHistory';
import StaffDashboard from '../screens/staff/StaffDashboard';

const Stack = createNativeStackNavigator();

export default function AppNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Login">
        
        <Stack.Screen 
          name="Login" 
          component={LoginScreen} 
          options={{ headerShown: false }} 
        />
        
        <Stack.Screen 
          name="DriverDashboard" 
          component={DriverDashboard} 
          options={{ title: 'Today\'s Jobs', headerBackVisible: false }} 
        />
        
        <Stack.Screen 
          name="ManagerDashboard" 
          component={ManagerDashboard} 
          options={{ title: 'Job Dispatcher', headerBackVisible: false }} 
        />
        <Stack.Screen 
          name="TodayJobs" 
          component={TodayJobs} 
          options={{ title: "Today's Jobs" }} 
        />

        <Stack.Screen
          name="StaffDashboard"
          component={StaffDashboard}
          options={{ title: 'Staff Dashboard', headerBackVisible: false }}
        />

        <Stack.Screen
          name="CreatePickup"
          component={CreatePickup}
          options={{
            title: "Create Pickup",
          }}
        />

        <Stack.Screen
          name="PickupHistory"
          component={PickupHistory}
          options={{ title: "Pickup History" }}
        />

        <Stack.Screen
          name="PickupDetails"
          component={PickupDetails}
          options={{ title: "Pickup Details" }}
        />

        <Stack.Screen
          name="AdminDashboard"
          component={AdminDashboard}
          options={{ title: 'Admin Dashboard', headerBackVisible: false }}
        />        
        
        <Stack.Screen 
          name="WeightEntry" 
          component={WeightEntry} 
          options={{ title: 'Enter Weight Details' }} 
        />

      </Stack.Navigator>
    </NavigationContainer>
  );
}
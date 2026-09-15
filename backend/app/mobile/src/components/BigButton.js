import { StyleSheet, Text, TouchableOpacity } from 'react-native';

export const ActionButton = ({ title, onPress, color = '#2196F3' }) => {
  return (
    <TouchableOpacity 
      style={[styles.button, { backgroundColor: color }]} 
      onPress={onPress}
    >
      <Text style={styles.text}>{title}</Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  button: {
    width: '100%',
    paddingVertical: 18,
    borderRadius: 8,
    alignItems: 'center',
    marginVertical: 10,
    elevation: 2, // Adds a tiny shadow on Android
  },
  text: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  }
});
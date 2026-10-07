import { StyleSheet, Text, View } from 'react-native';

export default function FeedScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Feed</Text>
      <Text style={styles.body}>Social posts placeholder — connect to public.posts next.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, justifyContent: 'center', backgroundColor: '#0B0B0F' },
  title: { color: '#F4F4F5', fontSize: 28, fontWeight: '800', marginBottom: 8 },
  body: { color: '#9CA3AF', fontSize: 15, lineHeight: 22 },
});

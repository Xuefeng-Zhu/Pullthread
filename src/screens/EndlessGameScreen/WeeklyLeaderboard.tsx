import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { leaderboardService } from '../../leaderboard/service';
import type { Standings } from '../../leaderboard/contracts';
import { useCommerceStore } from '../../store/useCommerceStore';
export function WeeklyLeaderboard({ onClose, status, highContrast }: { onClose: () => void; status: string | (() => string); highContrast: boolean }) {
  const [board, setBoard] = useState<Standings | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [clock, setClock] = useState(() => Date.now());
  const [offset, setOffset] = useState(0);
  const insets = useSafeAreaInsets();
  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const result = await leaderboardService.standings();
      setBoard(result); setOffset(result.serverTime - Date.now());
      useCommerceStore.getState().acceptWallet(result.wallet);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Leaderboard unavailable. Try again.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void Promise.resolve().then(refresh); const timer = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(timer); }, [refresh]);
  const seconds = board ? Math.max(0, Math.ceil((board.deadline - clock - offset) / 1000)) : 0;
  return <Modal visible animationType="none" onRequestClose={onClose} transparent>
    <View style={[styles.scrim, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]}>
      <View style={[styles.card, highContrast && { borderColor: '#18382e', borderWidth: 3 }]} accessibilityViewIsModal testID="weekly-leaderboard">
        <View style={styles.heading}><Text accessibilityRole="header" style={styles.title}>This week’s climb</Text>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close weekly leaderboard" style={styles.button}><Text style={styles.buttonText}>Close</Text></Pressable></View>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.copy}>Your best single run. All tools welcome.</Text>
          <Text style={styles.status}>{typeof status === 'function' ? status() : status}</Text>
          {board && <><Text style={styles.prizes}>{board.prizesEnabled ? '1st 100 · 2nd 50 · 3rd 25 points' : 'Practice week · prizes not yet enabled'}</Text>
            <Text style={styles.copy}>Ends {new Date(board.deadline).toLocaleString()}</Text>
            <Text style={styles.copy}>{seconds ? `${Math.floor(seconds / 86400)}d ${Math.floor(seconds % 86400 / 3600)}h ${Math.floor(seconds % 3600 / 60)}m remaining` : 'Week ended. Refresh for the new week.'}</Text>
            <Text style={styles.own}>{board.own ? `You · #${board.own.rank} · ${board.own.score} pockets` : 'Complete an online run to join the board.'}</Text>
            {board.leaders.map(row => <View key={row.rank} style={styles.row}><Text style={styles.rank}>{row.rank}</Text><Text style={styles.alias}>{row.alias}</Text><Text style={styles.score}>{row.score}</Text></View>)}
            {!board.leaders.length && <Text style={styles.copy}>A fresh piece of fabric. Set the first score!</Text>}
            {!!board.previous.length && <><Text accessibilityRole="header" style={styles.subheading}>Last week’s winners</Text>{board.previous.map(row => <Text key={row.rank} style={styles.copy}>#{row.rank} {row.alias} · {row.score} pockets</Text>)}</>}
            <Text style={styles.fine}>Weeks start Monday at 00:00 UTC. Ties go to the score verified first. Connect before the deadline to upload pending scores.</Text>
          </>}
          {!!error && <Text accessibilityLiveRegion="polite" style={styles.copy}>{error}</Text>}
          {loading ? <ActivityIndicator accessibilityLabel="Loading weekly leaderboard" color="#28594b" /> : <Pressable accessibilityRole="button" style={styles.button} onPress={() => void refresh()}><Text style={styles.buttonText}>Refresh</Text></Pressable>}
        </ScrollView>
      </View>
    </View>
  </Modal>;
}
const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(24,45,35,.65)', paddingHorizontal: 16, justifyContent: 'center' },
  card: { maxHeight: '100%', borderRadius: 24, backgroundColor: '#fff8e7', borderWidth: 2, borderColor: '#baa987', overflow: 'hidden' },
  heading: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 8 }, title: { flex: 1, fontSize: 26, fontFamily: 'Fraunces_600SemiBold', color: '#243f37' },
  content: { padding: 20, paddingTop: 0, gap: 12 }, copy: { fontSize: 14, color: '#344d40', lineHeight: 21 },
  status: { fontSize: 13, color: '#344d40' }, prizes: { fontSize: 17, fontWeight: '700', color: '#28594b' },
  own: { padding: 14, borderWidth: 1, borderStyle: 'dashed', borderColor: '#28594b', borderRadius: 12, color: '#243f37', fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderColor: '#d2c5ac', paddingVertical: 12 },
  rank: { minWidth: 28, color: '#344d40' }, alias: { flex: 1, color: '#243f37', fontSize: 15 }, score: { fontWeight: '700', color: '#243f37', fontSize: 18 },
  subheading: { fontSize: 20, color: '#243f37', marginTop: 8 }, fine: { fontSize: 12, lineHeight: 18, color: '#344d40' },
  button: { minHeight: 48, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 14, borderRadius: 12, backgroundColor: '#e4ead6' }, buttonText: { color: '#244b45', fontWeight: '700' },
});

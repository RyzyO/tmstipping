import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Pressable,
  ActivityIndicator,
  Image,
} from 'react-native';
import { DateTime } from 'luxon';
import { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { colors } from '../lib/theme';

type Race = {
  id: string;
  name: string;
  date: string;
  time: string;
  type?: string;
  comp_id: string;
};

type Stats = {
  userName: string;
  rank: string;
  wins: number;
  points: number;
};

function formatRank(rank: number | null): string {
  if (!rank || rank < 1) return '-';
  const j = rank % 10;
  const k = rank % 100;
  if (j === 1 && k !== 11) return `${rank}st`;
  if (j === 2 && k !== 12) return `${rank}nd`;
  if (j === 3 && k !== 13) return `${rank}rd`;
  return `${rank}th`;
}

export default function HomeScreen({ session }: { session: Session }) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState<Stats>({ userName: 'Guest', rank: '-', wins: 0, points: 0 });
  const [races, setRaces] = useState<Race[]>([]);
  const [noComp, setNoComp] = useState(false);

  const load = useCallback(async () => {
    const userId = session.user.id;

    const { data: userData } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    const userName = userData?.team_name || session.user.email || 'Guest';

    const { data: joinings } = await supabase
      .from('user_comp_joinings')
      .select('comp_id')
      .eq('user_id', userId)
      .eq('payment_status', 'completed');

    const compIds = [...new Set((joinings || []).map((j: any) => j.comp_id).filter(Boolean))];

    if (compIds.length === 0) {
      setStats({ userName, rank: '-', wins: 0, points: 0 });
      setRaces([]);
      setNoComp(true);
      return;
    }
    setNoComp(false);

    const { data: comps } = await supabase.from('comps').select('*').in('id', compIds);
    const activeComps = (comps || [])
      .filter((c: any) => c.status === 'active')
      .sort((a: any, b: any) => new Date(b.start_date).getTime() - new Date(a.start_date).getTime());

    if (activeComps.length === 0) {
      setStats({ userName, rank: '-', wins: 0, points: 0 });
      setRaces([]);
      setNoComp(true);
      return;
    }

    const compId = activeComps[0].id;

    const [{ data: joiningRow }, { data: allJoinings }] = await Promise.all([
      supabase.from('user_comp_joinings').select('*').eq('user_id', userId).eq('comp_id', compId).single(),
      supabase
        .from('user_comp_joinings')
        .select('user_id,points,wins,winners')
        .eq('comp_id', compId)
        .eq('payment_status', 'completed'),
    ]);

    const joining = joiningRow || {};
    const wins = Number(joining.wins ?? joining.winners ?? 0) || 0;
    const points = Number(joining.points || 0);

    const sorted = (allJoinings || [])
      .filter((e: any) => !!e.user_id)
      .sort((a: any, b: any) => Number(b.points || 0) - Number(a.points || 0));
    const rankIndex = sorted.findIndex((e: any) => e.user_id === userId) + 1;

    setStats({ userName, rank: formatRank(rankIndex || null), wins, points });

    const { data: raceRows } = await supabase.from('races').select('*').eq('comp_id', compId);
    const nowSydney = DateTime.now().setZone('Australia/Sydney');
    const upcoming = (raceRows || [])
      .filter((r: Race) => DateTime.fromISO(`${r.date}T${r.time}`, { zone: 'Australia/Sydney' }) >= nowSydney)
      .sort(
        (a: Race, b: Race) =>
          DateTime.fromISO(`${a.date}T${a.time}`, { zone: 'Australia/Sydney' }).toMillis() -
          DateTime.fromISO(`${b.date}T${b.time}`, { zone: 'Australia/Sydney' }).toMillis()
      );
    setRaces(upcoming);
  }, [session]);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color={colors.gold} size="large" />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.gold} />}
    >
      {/* Welcome card */}
      <View style={styles.card}>
        <Text style={styles.welcomeLabel}>Welcome back,</Text>
        <Text style={styles.welcomeName}>{stats.userName}</Text>
        <Text style={styles.welcomeSub}>Ready to make your picks for the upcoming races?</Text>
      </View>

      {noComp ? (
        <View style={styles.card}>
          <Text style={styles.emptyTitle}>No active competition</Text>
          <Text style={styles.emptyBody}>Join this year's competition to start tipping.</Text>
        </View>
      ) : (
        <>
          {/* Stats grid */}
          <View style={styles.statsRow}>
            <View style={styles.statCard}>
              <Text style={[styles.statValue, { color: colors.gold }]}>{stats.rank}</Text>
              <Text style={styles.statLabel}>Rank</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={[styles.statValue, { color: colors.green }]}>{stats.wins}</Text>
              <Text style={styles.statLabel}>Wins</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={[styles.statValue, { color: colors.blue }]}>{stats.points.toFixed(1)}</Text>
              <Text style={styles.statLabel}>Points</Text>
            </View>
          </View>

          {/* Upcoming races */}
          <Text style={styles.sectionTitle}>Upcoming Races</Text>
          {races.length === 0 ? (
            <View style={styles.card}>
              <Text style={styles.emptyTitle}>No Upcoming Races</Text>
              <Text style={styles.emptyBody}>Check back soon for new racing opportunities!</Text>
            </View>
          ) : (
            races.map((race) => {
              const dt = DateTime.fromISO(`${race.date}T${race.time}`, { zone: 'Australia/Sydney' });
              return (
                <View key={race.id} style={styles.raceCard}>
                  <View style={styles.raceHeaderRow}>
                    <Text style={styles.raceBadge}>{race.type || 'Open'}</Text>
                  </View>
                  <Text style={styles.raceName}>{race.name}</Text>
                  <Text style={styles.raceTime}>{dt.toFormat('EEE, LLL d • h:mm a')}</Text>
                  <Pressable style={styles.tipButton}>
                    <Text style={styles.tipButtonText}>Tip Now</Text>
                  </Pressable>
                </View>
              );
            })
          )}
        </>
      )}

      <Pressable style={styles.signOutButton} onPress={() => supabase.auth.signOut()}>
        <Text style={styles.signOutText}>Sign Out</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  loadingContainer: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center' },
  content: { padding: 16, paddingBottom: 40 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: 20,
    marginBottom: 16,
  },
  welcomeLabel: { color: colors.textMuted, fontSize: 14 },
  welcomeName: { color: colors.gold, fontSize: 24, fontWeight: '800', marginTop: 2, marginBottom: 8 },
  welcomeSub: { color: colors.textMuted, fontSize: 13 },
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  statCard: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: 14,
    alignItems: 'center',
  },
  statValue: { fontSize: 22, fontWeight: '800' },
  statLabel: { color: colors.textMuted, fontSize: 12, marginTop: 4 },
  sectionTitle: { color: colors.gold, fontSize: 20, fontWeight: '800', marginBottom: 12 },
  raceCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: 16,
    marginBottom: 12,
  },
  raceHeaderRow: { flexDirection: 'row', marginBottom: 6 },
  raceBadge: {
    color: colors.gold,
    fontSize: 11,
    fontWeight: '700',
    backgroundColor: 'rgba(217,119,6,0.2)',
    borderWidth: 1,
    borderColor: 'rgba(251,191,36,0.3)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    overflow: 'hidden',
  },
  raceName: { color: colors.text, fontSize: 16, fontWeight: '700', marginBottom: 4 },
  raceTime: { color: colors.textMuted, fontSize: 13, marginBottom: 12 },
  tipButton: {
    backgroundColor: colors.gold,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  tipButtonText: { color: colors.bg, fontWeight: '700', fontSize: 14 },
  emptyTitle: { color: colors.text, fontSize: 15, fontWeight: '700', marginBottom: 4 },
  emptyBody: { color: colors.textMuted, fontSize: 13 },
  signOutButton: { alignItems: 'center', marginTop: 8, padding: 12 },
  signOutText: { color: colors.red, fontWeight: '600' },
});

import Ionicons from '@expo/vector-icons/Ionicons';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useEffect, useRef } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { RootStackParamList } from '../../app/navigation/RootNavigator';
import {
  selectHasFullGame,
  useEntitlementStore,
} from '../../store/useEntitlementStore';
import {
  colors,
  opacity,
  radii,
  shadows,
  spacing,
  touchTargets,
} from '../../theme/tokens';

export interface PaywallScreenProps {
  readonly navigation: Pick<
    NativeStackNavigationProp<RootStackParamList, 'Paywall'>,
    'goBack'
  >;
}

const benefits = [
  {
    icon: 'map-outline',
    title: 'Nine additional handcrafted levels',
    detail: 'Continue through the Attic and Festival quilts.',
  },
  {
    icon: 'layers-outline',
    title: 'Additional fabric mechanics',
    detail: 'Master mixed materials, hazards, and elastic bumpers.',
  },
  {
    icon: 'git-branch-outline',
    title: 'Pocket stitch levels',
    detail: 'Catch, slow, and redirect the traveler in new ways.',
  },
  {
    icon: 'refresh-outline',
    title: 'Unlimited campaign replay',
    detail: 'Try every unlocked level again to improve your thread score.',
  },
] as const;

export function PaywallScreen({ navigation }: PaywallScreenProps) {
  const hasFullGame = useEntitlementStore(selectHasFullGame);
  const offer = useEntitlementStore((state) => state.offer);
  const status = useEntitlementStore((state) => state.status);
  const notice = useEntitlementStore((state) => state.notice);
  const purchaseFullGame = useEntitlementStore(
    (state) => state.purchaseFullGame,
  );
  const restorePurchases = useEntitlementStore(
    (state) => state.restorePurchases,
  );
  const refreshEntitlement = useEntitlementStore(
    (state) => state.refreshEntitlement,
  );
  const serviceKind = useEntitlementStore((state) => state.serviceKind);
  const attemptedOfferRefresh = useRef(false);

  const loading = status === 'idle' || status === 'refreshing';
  const busy = status === 'purchasing' || status === 'restoring';
  const purchaseDisabled = loading || busy || hasFullGame || offer === null;
  const restoreDisabled = loading || busy;

  useEffect(() => {
    if (
      attemptedOfferRefresh.current ||
      serviceKind !== 'revenuecat' ||
      offer !== null ||
      loading ||
      busy
    ) {
      return;
    }

    attemptedOfferRefresh.current = true;
    void refreshEntitlement();
  }, [busy, loading, offer, refreshEntitlement, serviceKind]);

  useEffect(() => {
    if (Platform.OS === 'ios' && notice?.message) {
      AccessibilityInfo.announceForAccessibility(notice.message);
    }
  }, [notice?.message]);

  const purchaseLabel = hasFullGame
    ? 'FULL ATELIER UNLOCKED'
    : status === 'purchasing'
      ? 'PURCHASING…'
      : offer
        ? `UNLOCK FULL ATELIER · ${offer.priceString}`
        : 'FULL ATELIER UNAVAILABLE';

  const statusMessage =
    notice?.message ??
    (hasFullGame
      ? 'Full Atelier is owned. Premium levels unlock as you progress.'
      : loading
        ? 'Checking Full Atelier access…'
        : status === 'purchasing'
          ? 'Completing your one-time purchase…'
          : status === 'restoring'
            ? 'Checking your store account for Full Atelier…'
            : offer === null
              ? 'The store offer is unavailable right now. You can still restore a previous purchase.'
              : 'One purchase unlocks the complete campaign on this store account.');

  const handlePurchase = () => {
    void purchaseFullGame();
  };
  const handleRestore = () => {
    void restorePurchases();
  };

  return (
    <SafeAreaView
      testID="paywall-screen"
      edges={['top', 'bottom']}
      style={styles.screen}
    >
      <ScrollView
        alwaysBounceVertical={false}
        contentContainerStyle={styles.content}
      >
        <View style={styles.topBar}>
          <View style={styles.eyebrowRow}>
            <Ionicons name="sparkles-outline" size={18} color="#EBC76B" />
            <Text style={styles.eyebrow}>THE QUILT CONTINUES</Text>
          </View>
          <Pressable
            testID="paywall-close-button"
            accessibilityRole="button"
            accessibilityLabel="Close Full Atelier"
            onPress={navigation.goBack}
            hitSlop={8}
            style={({ pressed }) => [
              styles.closeButton,
              pressed && styles.closeButtonPressed,
            ]}
          >
            <Ionicons name="close" size={26} color={colors.textOnDark} />
          </Pressable>
        </View>

        <View style={styles.heroCard}>
          <View style={styles.threadHalo} accessible={false}>
            <Ionicons name="flower-outline" size={46} color="#A93238" />
          </View>
          <Text accessibilityRole="header" style={styles.title}>
            Full Atelier
          </Text>
          <Text style={styles.subtitle}>
            Pull the whole handcrafted campaign into shape.
          </Text>
          <View style={styles.purchaseTypeBadge}>
            <Text style={styles.purchaseTypeCopy}>
              ONE-TIME UNLOCK · NO SUBSCRIPTION
            </Text>
          </View>
        </View>

        <View style={styles.benefitsPanel}>
          {benefits.map((benefit, index) => (
            <View
              key={benefit.title}
              style={[
                styles.benefitRow,
                index < benefits.length - 1 && styles.benefitDivider,
              ]}
            >
              <View style={styles.benefitIcon}>
                <Ionicons
                  name={benefit.icon}
                  size={22}
                  color="#A93238"
                />
              </View>
              <View style={styles.benefitCopy}>
                <Text style={styles.benefitTitle}>{benefit.title}</Text>
                <Text style={styles.benefitDetail}>{benefit.detail}</Text>
              </View>
            </View>
          ))}
        </View>

        <View
          testID="paywall-status"
          accessibilityLiveRegion="polite"
          style={[
            styles.statusPanel,
            notice?.kind === 'success' && styles.statusSuccess,
            notice?.kind === 'error' && styles.statusError,
          ]}
        >
          {loading || busy ? (
            <ActivityIndicator
              size="small"
              color={notice?.kind === 'error' ? '#FFF9EA' : '#315D5F'}
            />
          ) : (
            <Ionicons
              name={
                notice?.kind === 'error'
                  ? 'alert-circle-outline'
                  : hasFullGame || notice?.kind === 'success'
                    ? 'checkmark-circle-outline'
                    : 'information-circle-outline'
              }
              size={20}
              color={notice?.kind === 'error' ? '#FFF9EA' : '#315D5F'}
            />
          )}
          <Text
            style={[
              styles.statusCopy,
              notice?.kind === 'error' && styles.statusCopyOnDark,
            ]}
          >
            {statusMessage}
          </Text>
        </View>

        <Pressable
          testID="paywall-purchase-button"
          accessibilityRole="button"
          accessibilityLabel={purchaseLabel}
          accessibilityHint="Purchases the one-time Full Atelier unlock."
          accessibilityState={{
            disabled: purchaseDisabled,
            busy: status === 'purchasing',
          }}
          disabled={purchaseDisabled}
          onPress={handlePurchase}
          style={({ pressed }) => [
            styles.purchaseButton,
            purchaseDisabled && styles.controlDisabled,
            pressed && !purchaseDisabled && styles.purchaseButtonPressed,
          ]}
        >
          <Text style={styles.purchaseButtonLabel}>{purchaseLabel}</Text>
        </Pressable>

        <Pressable
          testID="paywall-restore-button"
          accessibilityRole="button"
          accessibilityLabel="Restore purchases"
          accessibilityHint="Checks this store account for a previous Full Atelier purchase."
          accessibilityState={{
            disabled: restoreDisabled,
            busy: status === 'restoring',
          }}
          disabled={restoreDisabled}
          onPress={handleRestore}
          style={({ pressed }) => [
            styles.restoreButton,
            restoreDisabled && styles.controlDisabled,
            pressed && !restoreDisabled && styles.restoreButtonPressed,
          ]}
        >
          <Text style={styles.restoreButtonLabel}>
            {status === 'restoring' ? 'RESTORING…' : 'RESTORE PURCHASES'}
          </Text>
        </Pressable>

        <Text style={styles.finePrint}>
          Pay once through your app-store account. No subscription, consumable
          currency, or recurring charge.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#162F3A',
  },
  content: {
    flexGrow: 1,
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  topBar: {
    minHeight: touchTargets.comfortable,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  eyebrow: {
    color: '#F3E5CA',
    fontFamily: 'NunitoSans_800ExtraBold',
    fontSize: 12,
    letterSpacing: 1.4,
  },
  closeButton: {
    width: touchTargets.minimum,
    height: touchTargets.minimum,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: 'rgba(243, 229, 202, 0.48)',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  closeButtonPressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
  },
  heroCard: {
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xl,
    borderRadius: radii.xl,
    borderWidth: 3,
    borderColor: '#C8A979',
    backgroundColor: '#F2E2C5',
    ...shadows.raised,
  },
  threadHalo: {
    width: 72,
    height: 72,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
    borderRadius: radii.pill,
    borderWidth: 2,
    borderColor: '#D49B92',
    borderStyle: 'dashed',
    backgroundColor: '#F8ECD5',
  },
  title: {
    color: colors.textPrimary,
    fontFamily: 'Fraunces_700Bold',
    fontSize: 34,
    letterSpacing: -0.4,
    textAlign: 'center',
  },
  subtitle: {
    maxWidth: 300,
    marginTop: spacing.xs,
    color: colors.textSecondary,
    fontFamily: 'NunitoSans_600SemiBold',
    fontSize: 16,
    lineHeight: 22,
    textAlign: 'center',
  },
  purchaseTypeBadge: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: '#173746',
  },
  purchaseTypeCopy: {
    color: '#FFF0C9',
    fontFamily: 'NunitoSans_800ExtraBold',
    fontSize: 11,
    letterSpacing: 0.7,
    textAlign: 'center',
  },
  benefitsPanel: {
    overflow: 'hidden',
    borderRadius: radii.lg,
    borderWidth: 2,
    borderColor: '#B49369',
    backgroundColor: '#EEDDBD',
    ...shadows.soft,
  },
  benefitRow: {
    minHeight: 74,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  benefitDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#C9AD85',
  },
  benefitIcon: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
    backgroundColor: '#F8ECD5',
  },
  benefitCopy: {
    flex: 1,
  },
  benefitTitle: {
    color: colors.textPrimary,
    fontFamily: 'NunitoSans_800ExtraBold',
    fontSize: 15,
    lineHeight: 20,
  },
  benefitDetail: {
    marginTop: spacing.xxs,
    color: colors.textSecondary,
    fontFamily: 'NunitoSans_500Medium',
    fontSize: 12,
    lineHeight: 17,
  },
  statusPanel: {
    minHeight: touchTargets.comfortable,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: '#B8A574',
    backgroundColor: '#FFF0C9',
  },
  statusSuccess: {
    borderColor: '#6D957D',
    backgroundColor: '#DDEADB',
  },
  statusError: {
    borderColor: '#C66A73',
    backgroundColor: '#7F2F38',
  },
  statusCopy: {
    flex: 1,
    color: colors.textPrimary,
    fontFamily: 'NunitoSans_600SemiBold',
    fontSize: 13,
    lineHeight: 18,
  },
  statusCopyOnDark: {
    color: colors.textOnDark,
  },
  purchaseButton: {
    minHeight: touchTargets.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: radii.lg,
    borderWidth: 3,
    borderColor: '#D88474',
    backgroundColor: '#A93238',
    ...shadows.raised,
  },
  purchaseButtonPressed: {
    transform: [{ translateY: 2 }],
    backgroundColor: '#8D2930',
  },
  purchaseButtonLabel: {
    color: colors.textOnDark,
    fontFamily: 'NunitoSans_800ExtraBold',
    fontSize: 16,
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  restoreButton: {
    minHeight: touchTargets.comfortable,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    minWidth: 220,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: '#D3C09B',
  },
  restoreButtonPressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.09)',
  },
  restoreButtonLabel: {
    color: '#F3E5CA',
    fontFamily: 'NunitoSans_800ExtraBold',
    fontSize: 14,
    letterSpacing: 0.6,
  },
  controlDisabled: {
    opacity: opacity.disabled,
  },
  finePrint: {
    alignSelf: 'center',
    maxWidth: 330,
    color: '#D9CAB1',
    fontFamily: 'NunitoSans_500Medium',
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
  },
});

/** @jest-environment node */
import { jest, test, expect, afterEach } from '@jest/globals';
import { render, fireEvent, cleanup } from '@testing-library/react-native';
import { ButtonStudio } from '../ButtonStudio';
import { useCollectionStore } from '../../../cosmetics/store';
import { ORIGINAL } from '../../../cosmetics/catalog';
import { useCommerceStore } from '../../../store/useCommerceStore';
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('../../../game/rendering/Traveler', () => ({ Traveler: () => null }));
afterEach(cleanup);
test('preview never spends, purchase is explicit, and Get points preserves the draft', async () => {
  const buy = jest.fn(async () => undefined); const equip = jest.fn(async () => undefined);
  useCollectionStore.setState({ appearance: ORIGINAL, owned: [], ready: true, busy: false, pending: false, error: '', initialize: async () => undefined, buy, equip });
  useCommerceStore.setState({ wallet: { points: 100, revision: 1, environment: 'sandbox' } });
  const screen = await render(<ButtonStudio onClose={() => undefined} highContrast />);
  await fireEvent.press(screen.getByTestId('cosmetic-color-coral'));
  expect(buy).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByText('Buy color · 25 points')); expect(buy).toHaveBeenCalledWith('color-coral');
  await fireEvent.press(screen.getByText('Get points'));
  expect(screen.getByText('Point Shop')).toBeTruthy();
  expect(screen.queryByTestId('points-shop-open-store')).toBeNull();
  await fireEvent.press(screen.getByTestId('points-shop-back'));
  expect(screen.queryByText('Points & tools')).toBeNull();
  expect(screen.getByText('Button Studio')).toBeTruthy();
  expect(screen.getByText('Buy color · 25 points')).toBeTruthy();
});
test('owned combination equips with no purchase and close returns to origin', async () => {
  const buy = jest.fn(async () => undefined); const equip = jest.fn(async () => undefined); const close = jest.fn();
  useCollectionStore.setState({ appearance: ORIGINAL, owned: ['color-sky'], ready: false, busy: false, pending: false, error: 'Offline', initialize: async () => undefined, buy, equip });
  const screen = await render(<ButtonStudio onClose={close} />);
  await fireEvent.press(screen.getByTestId('cosmetic-color-sky')); await fireEvent.press(screen.getByText('Equip look'));
  expect(equip).toHaveBeenCalledWith({ ...ORIGINAL, color: 'color-sky' }); expect(buy).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByText('Close')); expect(close).toHaveBeenCalled();
});

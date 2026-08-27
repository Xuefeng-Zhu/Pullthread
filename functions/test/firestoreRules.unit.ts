import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';

const PROJECT_ID = 'pullthread-rules-test';
const OWNER_ID = 'anonymousOwner123';
const OTHER_ID = 'anonymousOther456';
const CHALLENGE_ID = 'daily-2026-08-27-p1-first-pull-sampler-v1';

let environment: RulesTestEnvironment;

before(async () => {
  environment = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(
        resolve(__dirname, '../../firestore.rules'),
        'utf8',
      ),
    },
  });
});

beforeEach(async () => {
  await environment.clearFirestore();
});

after(async () => {
  await environment.cleanup();
});

async function seedPublicDocuments(): Promise<void> {
  await environment.withSecurityRulesDisabled(async (context) => {
    const database = context.firestore();
    await Promise.all([
      setDoc(doc(database, 'profiles', OWNER_ID), {
        displayName: 'Quilter 1234',
        createdAt: new Date('2026-08-27T00:00:00.000Z'),
        updatedAt: new Date('2026-08-27T00:00:00.000Z'),
      }),
      setDoc(doc(database, 'daily_challenges', CHALLENGE_ID), {
        id: CHALLENGE_ID,
        challengeDate: '2026-08-27',
      }),
      setDoc(
        doc(
          database,
          'daily_challenges',
          CHALLENGE_ID,
          'runs',
          OWNER_ID,
        ),
        {
          userId: OWNER_ID,
          displayName: 'Quilter 1234',
          createdAt: '2026-08-27T12:00:00.000Z',
          metrics: {
            threadUsed: 42,
            stitchesUsed: 1,
            completionMs: 1500,
          },
        },
      ),
    ]);
  });
}

describe('Pullthread Firestore rules', () => {
  test('allows public reads but requires bounded collection queries', async () => {
    await seedPublicDocuments();
    const database = environment.unauthenticatedContext().firestore();

    await assertSucceeds(getDoc(doc(database, 'profiles', OWNER_ID)));
    await assertSucceeds(
      getDoc(doc(database, 'daily_challenges', CHALLENGE_ID)),
    );
    await assertSucceeds(
      getDoc(
        doc(
          database,
          'daily_challenges',
          CHALLENGE_ID,
          'runs',
          OWNER_ID,
        ),
      ),
    );
    await assertSucceeds(
      getDocs(
        query(
          collection(
            database,
            'daily_challenges',
            CHALLENGE_ID,
            'runs',
          ),
          limit(25),
        ),
      ),
    );
    await assertFails(
      getDocs(
        collection(
          database,
          'daily_challenges',
          CHALLENGE_ID,
          'runs',
        ),
      ),
    );
  });

  test('denies all direct challenge and run writes', async () => {
    const database = environment
      .authenticatedContext(OWNER_ID, { firebase: { sign_in_provider: 'anonymous' } })
      .firestore();

    await assertFails(
      setDoc(doc(database, 'daily_challenges', CHALLENGE_ID), {
        challengeDate: '2026-08-27',
      }),
    );
    await assertFails(
      setDoc(
        doc(
          database,
          'daily_challenges',
          CHALLENGE_ID,
          'runs',
          OWNER_ID,
        ),
        { metrics: {} },
      ),
    );
    await assertFails(
      setDoc(doc(database, 'daily_submission_guards', OWNER_ID), {
        lastSubmissionAt: serverTimestamp(),
      }),
    );
    await assertFails(
      getDoc(doc(database, 'daily_submission_guards', OWNER_ID)),
    );
  });

  test('lets a guest maintain only its safe public profile fields', async () => {
    const ownerDatabase = environment
      .authenticatedContext(OWNER_ID, { firebase: { sign_in_provider: 'anonymous' } })
      .firestore();
    const profileRef = doc(ownerDatabase, 'profiles', OWNER_ID);

    await assertSucceeds(
      setDoc(profileRef, {
        displayName: 'Quilter 1234',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
    await assertSucceeds(
      updateDoc(profileRef, {
        displayName: 'Quilter 5678',
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      updateDoc(profileRef, {
        role: 'admin',
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      updateDoc(profileRef, {
        displayName: '<script>alert(1)</script>',
        updatedAt: serverTimestamp(),
      }),
    );

    const otherDatabase = environment
      .authenticatedContext(OTHER_ID, { firebase: { sign_in_provider: 'anonymous' } })
      .firestore();
    await assertFails(
      updateDoc(doc(otherDatabase, 'profiles', OWNER_ID), {
        displayName: 'Stolen Name',
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(deleteDoc(profileRef));

    const stored = await assertSucceeds(getDoc(profileRef));
    assert.equal(stored.data()?.displayName, 'Quilter 5678');
  });
});

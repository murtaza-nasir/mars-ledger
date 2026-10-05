// The two personal phone settings beside Hints ("Show VP changes", "Confirm card purchases"): off by default, stored on
// the profile or beside the game for a seat without one, outside the command log, and old databases upgrade.
import {describe, expect, it} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import * as path from 'node:path';
import {Store} from '../src/server/store';
import {ProfileDesk} from '../src/server/profiles';

const dir = () => mkdtempSync(path.join(tmpdir(), 'tm-prefs-'));

describe('seat settings', () => {
  it('start off, change one at a time, and never touch the command log', () => {
    const store = new Store(dir());
    const game = store.currentGameId();
    store.setSeatHints(game, 'a', true);
    store.setSeatFlags(game, 'a', {showVp: true});
    store.setSeatFlags(game, 'b', {confirmBuy: true});
    expect(store.seatPrefs(game)).toEqual({a: {hints: true, showVp: true}, b: {hints: false, confirmBuy: true}});
    store.setSeatFlags(game, 'a', {confirmBuy: true});
    store.setSeatFlags(game, 'a', {showVp: false});
    expect(store.seatPrefs(game).a).toEqual({hints: true, confirmBuy: true});
    store.setSeatHints(game, 'a', false);
    expect(store.seatPrefs(game).a).toEqual({hints: false, confirmBuy: true});
    expect(store.commands(game)).toEqual([]);
  });

  it('survive a restart (they are in the database)', () => {
    const d = dir();
    const first = new Store(d);
    const game = first.currentGameId();
    first.setSeatFlags(game, 'a', {showVp: true, confirmBuy: true});
    const again = new Store(d);
    expect(again.seatPrefs(game).a).toEqual({hints: false, showVp: true, confirmBuy: true});
  });

  it('a seat table from before these settings gets the columns', () => {
    const d = dir();
    const old = new DatabaseSync(path.join(d, 'tm.db'));
    old.exec(`CREATE TABLE games (id TEXT PRIMARY KEY, created INTEGER NOT NULL, archived INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE seat_prefs (game TEXT NOT NULL, player TEXT NOT NULL, hints INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (game, player));
      INSERT INTO games (id, created) VALUES ('g1', 1);
      INSERT INTO seat_prefs (game, player, hints) VALUES ('g1', 'a', 1);`);
    old.close();
    const store = new Store(d);
    expect(store.seatPrefs('g1')).toEqual({a: {hints: true}});
    store.setSeatFlags('g1', 'a', {showVp: true});
    expect(store.seatPrefs('g1').a).toEqual({hints: true, showVp: true});
  });
});

describe('profile settings', () => {
  const make = () => {
    const desk = new ProfileDesk(new Store(dir()).db);
    desk.create({id: 'prof-ann1', name: 'Ann', color: 'red'});
    return desk;
  };

  it('start off, are saved on the person and kept through other edits', () => {
    const desk = make();
    expect(desk.get('prof-ann1')).toMatchObject({name: 'Ann'});
    expect(desk.get('prof-ann1')!.showVp).toBeUndefined();
    expect(desk.update('prof-ann1', {showVp: true}).showVp).toBe(true);
    expect(desk.update('prof-ann1', {confirmBuy: true})).toMatchObject({showVp: true, confirmBuy: true});
    expect(desk.update('prof-ann1', {name: 'Anna'})).toMatchObject({showVp: true, confirmBuy: true});
    expect(desk.list()[0]).toMatchObject({showVp: true, confirmBuy: true});
    expect(desk.update('prof-ann1', {showVp: false}).showVp).toBeUndefined();
  });

  it('refuse anything but on or off', () => {
    const desk = make();
    expect(() => desk.update('prof-ann1', {showVp: 'yes'})).toThrow('Show VP changes is either on or off');
    expect(() => desk.update('prof-ann1', {confirmBuy: 1})).toThrow('Confirm card purchases is either on or off');
  });

  it('a version-2 profile table upgrades without losing anyone', () => {
    const d = dir();
    const v2 = new DatabaseSync(path.join(d, 'tm.db'));
    v2.exec(`CREATE TABLE profiles (id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL, avatar TEXT, created INTEGER NOT NULL, merged_into TEXT, hints INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE devices (device TEXT PRIMARY KEY, profile TEXT NOT NULL, at INTEGER NOT NULL);
      CREATE TABLE results (game TEXT NOT NULL, profile TEXT NOT NULL, ended_at INTEGER NOT NULL, json TEXT NOT NULL, PRIMARY KEY (game, profile));
      CREATE TABLE recorded_games (game TEXT PRIMARY KEY, ended_at INTEGER NOT NULL, json TEXT NOT NULL);
      CREATE TABLE unlocks (profile TEXT NOT NULL, achievement TEXT NOT NULL, game TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (profile, achievement));
      INSERT INTO profiles (id, name, color, avatar, created, hints) VALUES ('prof-ann1', 'Ann', 'red', 'R17', 5, 1);
      PRAGMA user_version = 2;`);
    v2.close();
    const desk = new ProfileDesk(new Store(d).db);
    expect(desk.get('prof-ann1')).toEqual({id: 'prof-ann1', name: 'Ann', color: 'red', avatar: 'R17', created: 5, hints: true});
    expect(desk.update('prof-ann1', {confirmBuy: true}).confirmBuy).toBe(true);
  });
});

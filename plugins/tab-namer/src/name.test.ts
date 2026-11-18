import { assert, test } from 'orca/testing'
import { composeName, taskFromPrompt } from './name'

test('drops how-it-was-asked filler', () => {
  assert.equal(taskFromPrompt('Hey, can you please fix the flaky login test.'), 'fix the flaky login test')
  assert.equal(taskFromPrompt("I'd like you to add retries to the uploader"), 'add retries to the uploader')
})

test('skips slash commands, fences and blank lines', () => {
  assert.equal(taskFromPrompt('\n/clear\n```ts\nconst x = 1\n```\nrename the cache module'), 'rename the cache module')
  assert.equal(taskFromPrompt('/review'), '')
})

test('strips ANSI, control characters and quotes', () => {
  assert.equal(taskFromPrompt('\x1b[32mupdate "the" readme\x07\x1b[0m'), 'update the readme')
})

test('strips bidi overrides and line separators', () => {
  // Built from code points so no raw separator sits in this source file.
  const rlo = String.fromCharCode(0x202e)
  const lineSeparator = String.fromCharCode(0x2028)
  assert.equal(taskFromPrompt(`${rlo}evil${lineSeparator} title`), 'evil title')
})

test('cuts on a word boundary and capitalizes', () => {
  assert.equal(composeName('fix the flaky login test in auth', 24), 'Fix the flaky login test')
  assert.equal(composeName('short', 24), 'Short')
})

test('hard-cuts one long word rather than returning nothing', () => {
  assert.equal(composeName('supercalifragilisticexpialidocious', 10), 'Supercalif')
})

test('cleans a model answer: first line, list marker, label, quotes', () => {
  assert.equal(composeName('\n1. Title: "Fix auth test"\nextra', 24), 'Fix auth test')
})

test('keeps leading digits that are not a list marker', () => {
  assert.equal(composeName('2FA login broken', 24), '2FA login broken')
  assert.equal(composeName('404 page fix', 24), '404 page fix')
  assert.equal(composeName('3) add retries', 24), 'Add retries')
})

test('never starts with a dash the CLI would read as a flag', () => {
  assert.equal(composeName('Title: --help', 24), 'Help')
  assert.equal(composeName('--json', 24), 'Json')
})

test('nothing usable gives null', () => {
  assert.equal(composeName('  \n ', 24), null)
  assert.equal(composeName('"..."', 24), null)
})

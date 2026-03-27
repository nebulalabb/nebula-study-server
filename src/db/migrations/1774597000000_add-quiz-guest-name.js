/* eslint-disable camelcase */
export const shorthands = undefined;

export const up = pgm => {
  pgm.addColumn('quiz_attempts', {
    guest_name: { type: 'text' }
  });
};

export const down = pgm => {
  pgm.dropColumn('quiz_attempts', 'guest_name');
};

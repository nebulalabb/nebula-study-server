/**
 * Migration — Add source_filename to notes table
 */
export const up = (pgm) => {
  pgm.addColumns('notes', {
    source_filename: { type: 'TEXT' }
  });
};

export const down = (pgm) => {
  pgm.dropColumns('notes', ['source_filename']);
};

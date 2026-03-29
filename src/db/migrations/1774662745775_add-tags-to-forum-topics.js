export const up = (pgm) => {
  pgm.addColumn('forum_topics', {
    tags: { type: 'text[]', default: '{}' }
  });
};

export const down = (pgm) => {
  pgm.dropColumn('forum_topics', 'tags');
};

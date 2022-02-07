// noinspection WebpackConfigHighlighting
module.exports = {
  output: {
    filename: 'react16-advertising.min.js',
    library: 'React16Advertising',
    libraryTarget: 'umd',
  },
  externals: {
    react: {
      commonjs: 'react',
      commonjs2: 'react',
      amd: 'react',
      root: 'React',
    },
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        use: ['babel-loader'],
      },
    ],
  },
  mode: 'production',
  devtool: 'source-map',
};

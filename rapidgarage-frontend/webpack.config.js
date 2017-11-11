module.exports = {
  entry: './app/index.js',
  output: {
    filename: 'bundle.js'
  },
  devServer: {
    port: 3000
  },
  module: {
    loaders: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        loader: 'babel-loader'
      }
    ]
  }
};

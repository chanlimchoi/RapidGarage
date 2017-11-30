module.exports = {
  entry: './app/index.js',
  output: {
    filename: 'bundle.js'
  },
  devServer: {
    port: 3000,
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        pathRewrite: {"^/api" : ""}
      }
    }
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

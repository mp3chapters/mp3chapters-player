import path from 'path';
import CopyWebpackPlugin from 'copy-webpack-plugin';

export default {
    entry: './src-web/main-web.js',
    output: {
        filename: 'main.js',
        path: path.resolve('dist'),
        chunkFilename: '[name].bundle.js',
        clean: true,
    },
    devServer: {
        static: {
            directory: path.join('dist'),
        },
        hot: true,
        open: false
    },
    devtool: false,
    mode: 'production',
    module: {
        rules: [
            {
                test: /\.css$/i,
                use: ['style-loader', 'css-loader'],
            }
        ],
    },
    plugins: [
        new CopyWebpackPlugin({
            patterns: [
                { from: 'src-web/index.html', to: 'index.html' },
                // { from: 'src-web/example.mp3', to: 'example.mp3' },
                // { from: 'src-web/silence.mp3', to: 'silence.mp3' },
                { from: 'src-web/instruction.svg', to: 'instruction.svg' },
                { from: 'src-web/vidstack', to: 'vidstack', globOptions: { ignore: ['**/.DS_Store'] } },
            ],
        }),
    ],
    resolve: {
        alias: {
            '@common': path.resolve('src-common/'),
        },
    },
};

import path from 'path';

export default {
    entry: './src-app/main.js',
    output: {
        filename: 'main.js',
        path: path.resolve('src-app/dist'),
    },
    mode: 'development',
    module: {
        rules: [
            {
                test: /\.css$/i,
                use: ['style-loader', 'css-loader'],
            }
        ],
    },
    resolve: {
        alias: {
            '@common': path.resolve('src-common/'),
        },
    }
};
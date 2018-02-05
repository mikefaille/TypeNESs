module.exports = {
    globals: {
        "ts-jest": {
            tsConfigFile: "tsconfig.json"
        }
    },
    moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
    transform: {
        "^.+\\.tsx?$": "ts-jest"
    },
    testRegex: "(/__tests__/.*|(\\.|/)(test|spec))\\.(tsx?)$",
};

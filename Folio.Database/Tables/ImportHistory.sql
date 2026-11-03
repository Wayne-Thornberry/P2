-- What each bank import brought in, so the transactions page can say where a row came
-- from and the user can see what they have already imported.
CREATE TABLE [folio].[ImportHistory]
(
    [Country]   NVARCHAR (40)  NOT NULL,
    [Id]        INT            NOT NULL,
    [Date]      DATETIME2 (3)  NOT NULL,
    [BankName]  NVARCHAR (100) NOT NULL,
    [AdapterId] NVARCHAR (32)  NOT NULL,
    [FileName]  NVARCHAR (260) NOT NULL,
    [RowCount]  INT            NOT NULL,
    [SortOrder] INT            NOT NULL,
    CONSTRAINT [PK_ImportHistory] PRIMARY KEY CLUSTERED ([Country], [Id])
);